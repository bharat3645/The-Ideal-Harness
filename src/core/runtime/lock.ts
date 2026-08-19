/**
 * Zero-dependency advisory file lock — the shared mutex primitive behind
 * issue #17's fix for lost-update races on persisted state (memory's
 * structural graph + episodic store, orchestrate's ledger + spend
 * checkpoint).
 *
 * The mutex is `fs.openSync(path, 'wx')`: an exclusive-create that the OS
 * itself makes atomic — two processes racing to open the same path with
 * `'wx'` are guaranteed exactly one success and one `EEXIST`, with no
 * check-then-create window to race in the first place. No lockfile library
 * needed; this project ships zero runtime dependencies by design
 * (`decisions.md` D007), and this primitive is already what one would sit on
 * top of.
 *
 * See `decisions.md` D039 for the wait-vs-fail and staleness-threshold
 * reasoning.
 */

import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';

/** A lock older than this is assumed abandoned by a crashed/killed holder, not actively held. */
export const LOCK_STALE_MS = 30_000;

/** Bounded wait for a lock that is NOT yet stale (a live holder, presumably mid-write). */
const DEFAULT_MAX_WAIT_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAY_MS = 50;

/** Caps how many times a repeatedly-recreated lock is treated as stale in one call, so a
 *  pathological case (something keeps re-creating a fresh lock the instant this clears the
 *  old one) still terminates via the bounded-wait path instead of looping forever. */
const MAX_STALE_CLEARS = 5;

export interface FileLockOptions {
  /** Override `LOCK_STALE_MS` for this call. */
  readonly staleMs?: number;
  /** Override the bounded-wait attempt count for a non-stale, actively-held lock. */
  readonly maxWaitAttempts?: number;
  /** Override the delay between wait attempts. */
  readonly retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Attempt exclusive-create. Returns this call's unique release token on success, or null. */
function tryAcquire(lockPath: string): string | null {
  const token = randomBytes(16).toString('hex');
  try {
    const fd = openSync(lockPath, 'wx');
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now(), token }));
    } finally {
      closeSync(fd);
    }
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return null;
    }
    // Anything else (e.g. permission denied, missing parent dir) is a real
    // failure, not "someone else holds the lock" — surface it, don't mask it
    // as ordinary contention.
    throw error;
  }
}

/**
 * True only if the lock file at `lockPath` still holds the exact token this
 * call acquired. Guards the one race the staleness mechanism itself opens up:
 * if this holder's own operation runs longer than `staleMs`, a second caller
 * may legitimately conclude the lock is abandoned, clear it, and acquire its
 * own — at which point the FIRST holder's eventual release must not blindly
 * `rmSync` whatever is at `lockPath` now, or it would delete the second
 * holder's live lock and let a third caller acquire concurrently with the
 * second. Comparing the token before removing makes release a no-op once a
 * holder has been superseded, instead of a silent double-unlock.
 */
function ownsLock(lockPath: string, token: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: string };
    return parsed.token === token;
  } catch {
    return false;
  }
}

/** An unreadable/corrupt lock file is treated as stale — never wedge forever on a lock
 *  whose own bookkeeping is broken; that would be the opposite of what this exists for. */
function isStale(lockPath: string, staleMs: number): boolean {
  try {
    const { ts } = JSON.parse(readFileSync(lockPath, 'utf8')) as { ts?: number };
    return typeof ts !== 'number' || Date.now() - ts > staleMs;
  } catch {
    return true;
  }
}

/**
 * Run `fn` with an exclusive advisory lock held at `lockPath`. The lock is
 * always released — including when `fn` throws — via try/finally, so an
 * error mid-operation cannot leave a permanent lock; at worst it leaves one
 * that self-heals via the staleness check on the next acquisition attempt.
 *
 * Acquisition: try exclusive-create; if it's held and NOT stale, wait with a
 * bounded number of short retries (a live holder is presumably mid-write —
 * this project's persisted state is small JSON, so contention should clear
 * in milliseconds) and throw a clear, actionable error if it never clears;
 * if it IS stale (older than `staleMs`, i.e. abandoned by a crashed/killed
 * process), remove it and retry immediately, without spending wait budget.
 *
 * `lockPath` should live alongside the state file it protects (e.g.
 * `<statefile>.lock`) — one lock per protected file, not one global lock,
 * so unrelated state (the ledger vs. the spend checkpoint vs. the graph)
 * isn't needlessly serialized against unrelated writers.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const maxWaitAttempts = options.maxWaitAttempts ?? DEFAULT_MAX_WAIT_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let waitAttempts = 0;
  let staleClears = 0;
  let token: string | null = null;
  for (;;) {
    token = tryAcquire(lockPath);
    if (token !== null) {
      break;
    }
    if (staleClears < MAX_STALE_CLEARS && isStale(lockPath, staleMs)) {
      staleClears += 1;
      try {
        rmSync(lockPath, { force: true });
      } catch {
        // Another process may already be racing to clean up the same stale
        // lock; either way, loop back to tryAcquire and let 'wx' arbitrate.
      }
      continue;
    }
    waitAttempts += 1;
    if (waitAttempts > maxWaitAttempts) {
      throw new Error(
        `could not acquire lock at ${lockPath} after ${maxWaitAttempts} attempts ` +
          `(~${Math.round((maxWaitAttempts * retryDelayMs) / 1000)}s) — held by another process`,
      );
    }
    await sleep(retryDelayMs);
  }

  try {
    return await fn();
  } finally {
    try {
      // Only remove the lock if it's still the one THIS call acquired — see
      // `ownsLock`'s docblock. If `fn` ran longer than `staleMs` and a second
      // caller has since taken over, this is a deliberate no-op, not a bug:
      // removing it would delete the second holder's live lock.
      if (token !== null && ownsLock(lockPath, token)) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // Best-effort release. A lingering lock file (e.g. this process was
      // killed between the finally starting and rmSync completing — a very
      // small window) self-heals via the staleness check above.
    }
  }
}

/** Conventional lock path for a given state file — lives right next to it. */
export function lockPathFor(statePath: string): string {
  return `${statePath}.lock`;
}
