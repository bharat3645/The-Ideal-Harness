/**
 * Guard decision journal — "nothing invisible."
 *
 * Every PreToolUse decision is appended as one JSON line to a project-local,
 * append-only journal: what was asked, what the floor decided, under which
 * mode, and whether the decision was softened. This is the substrate for
 * auditing ("why did that happen") and for the self-learning loop (`learn.ts`
 * reads the journal to *propose* policy entries — never to apply them).
 *
 * Properties:
 *   - Project-local (`<cwd>/.ideal-harness/guard-journal.jsonl`), never $HOME —
 *     same isolation contract as memory. The directory is already gitignored.
 *   - Subjects are secret-redacted and truncated BEFORE they are written; the
 *     journal must never become the leak it exists to prevent.
 *   - Fail-open, silent: journaling is observability, not enforcement. A full
 *     disk must never block a tool call.
 *   - `IDEAL_HARNESS_JOURNAL=off` is the kill-switch.
 *   - Hash-chained: each entry stores `hash` = sha256(prevHash + its own
 *     content) and `prevHash` = the previous entry's hash. Tampering with or
 *     deleting a line breaks the chain from that point forward, so
 *     `verifyJournalChain` can prove the journal wasn't quietly edited after
 *     the fact — the same tamper-evidence property an audit log needs.
 *     Entries written before this feature shipped have no hash (`undefined`)
 *     and are reported as unverifiable, never as tampered.
 *   - Rotated, not unbounded: once the active file reaches
 *     `JOURNAL_MAX_ENTRIES` (default 5000, override via
 *     `IDEAL_HARNESS_JOURNAL_MAX_ENTRIES`; `0` or negative disables
 *     rotation), it is renamed to `guard-journal.N.jsonl` before the next
 *     entry is appended — never truncated or deleted. Each archive keeps its
 *     own internal hash chain fully verifiable; the fresh active file starts
 *     a new chain from genesis, the same way a pre-chain/legacy file already
 *     does (`readLastHash` degrades to genesis whenever the active file is
 *     missing). A human decides if/when to prune old archives — this module
 *     never deletes audit history on its own.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FloorMode } from './bypass.js';
import type { PolicyDecision } from './policy/types.js';
import { redactSecrets } from './redact.js';

export const JOURNAL_ENV_VAR = 'IDEAL_HARNESS_JOURNAL';

/** Max subject length persisted per entry — enough to learn from, small enough to stay lean. */
export const JOURNAL_SUBJECT_MAX = 240;

/** Operator override for the rotation threshold; `0` or negative disables rotation. */
export const JOURNAL_MAX_ENTRIES_ENV_VAR = 'IDEAL_HARNESS_JOURNAL_MAX_ENTRIES';

/** Default rotation threshold (entries) before the active journal is archived. */
export const JOURNAL_MAX_ENTRIES_DEFAULT = 5000;

export interface GuardJournalEntry {
  /** ISO-8601 timestamp, supplied by the caller (keeps this module pure of clocks). */
  readonly ts: string;
  readonly tool: string;
  /** Redacted, truncated subject (command / path / url) the decision was made on. */
  readonly subject: string;
  readonly action: PolicyDecision['action'];
  readonly ruleId: string;
  readonly mode: FloorMode;
  /** Present (true) only when a deny was downgraded by soft mode. */
  readonly softened?: boolean;
  /** Chain link to the previous entry's `hash` (or genesis for the first chained entry). Absent on pre-chain entries. */
  readonly prevHash?: string;
  /** sha256(prevHash + this entry's own content). Absent on pre-chain entries. */
  readonly hash?: string;
}

/** The fixed anchor hash for the first entry ever chained in a journal. */
export const JOURNAL_GENESIS_HASH = '0'.repeat(64);

/** Deterministic hash of one entry's content, chained to `prevHash`. Pure — no I/O, no clock. */
export function chainHash(prevHash: string, entry: GuardJournalEntry): string {
  const payload = JSON.stringify({
    prevHash,
    ts: entry.ts,
    tool: entry.tool,
    subject: entry.subject,
    action: entry.action,
    ruleId: entry.ruleId,
    mode: entry.mode,
    softened: entry.softened === true,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export interface ChainVerification {
  readonly ok: boolean;
  /** How many hash-bearing entries were actually verified (legacy entries don't count). */
  readonly checked: number;
  readonly brokenAtIndex?: number;
  readonly reason?: string;
}

/**
 * Verify tamper-evidence over a parsed entry list. Legacy entries (no `hash`)
 * reset the chain anchor rather than failing — they predate this feature and
 * are unverifiable, not tampered. Any hash-bearing entry whose own content no
 * longer matches its stored hash, or whose `prevHash` doesn't link to the
 * previous chained entry, breaks the chain from that index.
 */
export function verifyJournalChain(entries: readonly GuardJournalEntry[]): ChainVerification {
  let expectedPrev: string | undefined;
  let checked = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) {
      continue;
    }
    if (entry.hash === undefined || entry.prevHash === undefined) {
      expectedPrev = undefined; // pre-chain entry: not itself verifiable, chain resumes after it
      continue;
    }
    if (chainHash(entry.prevHash, entry) !== entry.hash) {
      return { ok: false, checked, brokenAtIndex: i, reason: 'entry hash does not match its own content' };
    }
    if (expectedPrev !== undefined && entry.prevHash !== expectedPrev) {
      return { ok: false, checked, brokenAtIndex: i, reason: 'entry is not linked to the previous chained entry' };
    }
    expectedPrev = entry.hash;
    checked += 1;
  }
  return { ok: true, checked };
}

export interface BuildEntryInput {
  readonly ts: string;
  readonly tool: string;
  readonly subject: string;
  readonly decision: PolicyDecision;
  readonly mode: FloorMode;
  readonly softened?: boolean;
}

/** Build a journal entry: redact + truncate the subject, keep only what auditing needs. */
export function buildJournalEntry(input: BuildEntryInput): GuardJournalEntry {
  const redacted = redactSecrets(input.subject).text;
  const subject = redacted.length > JOURNAL_SUBJECT_MAX ? `${redacted.slice(0, JOURNAL_SUBJECT_MAX)}…` : redacted;
  return {
    ts: input.ts,
    tool: input.tool,
    subject,
    action: input.decision.action,
    ruleId: input.decision.ruleId,
    mode: input.mode,
    ...(input.softened === true ? { softened: true } : {}),
  };
}

/** The project-local journal path. */
export function journalPath(cwd: string = process.cwd()): string {
  return join(cwd, '.ideal-harness', 'guard-journal.jsonl');
}

export interface AppendOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

/** Read the most recent entry's `hash` from an existing journal file, or genesis if none/unreadable. */
function readLastHash(path: string): string {
  try {
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i] as string) as { hash?: unknown };
        return typeof parsed.hash === 'string' ? parsed.hash : JOURNAL_GENESIS_HASH;
      } catch {
        // skip a malformed trailing line and keep looking backward
      }
    }
    return JOURNAL_GENESIS_HASH;
  } catch {
    return JOURNAL_GENESIS_HASH; // no file yet, or unreadable — start a fresh chain
  }
}

/** Count non-empty lines in a file, or 0 if it doesn't exist / can't be read. */
function countEntries(path: string): number {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '').length;
  } catch {
    return 0;
  }
}

/** First `guard-journal.N.jsonl` archive name (alongside `path`) that doesn't already exist. */
function nextArchivePath(path: string): string {
  const dir = dirname(path);
  const base = path.slice(dir.length + 1).replace(/\.jsonl$/, '');
  let n = 1;
  let candidate = join(dir, `${base}.${n}.jsonl`);
  while (existsSync(candidate)) {
    n += 1;
    candidate = join(dir, `${base}.${n}.jsonl`);
  }
  return candidate;
}

/**
 * Archive the active journal (rename, never delete/truncate) once it reaches
 * `maxEntries`. Best-effort: a rename failure just means rotation didn't
 * happen this call — observability must never block enforcement.
 */
function rotateIfNeeded(path: string, maxEntries: number): void {
  if (maxEntries <= 0 || countEntries(path) < maxEntries) {
    return;
  }
  try {
    renameSync(path, nextArchivePath(path));
  } catch {
    // best-effort — the active file just keeps growing past the threshold this once
  }
}

function resolveMaxEntries(env: Record<string, string | undefined>): number {
  const raw = env[JOURNAL_MAX_ENTRIES_ENV_VAR]?.trim();
  if (!raw) {
    return JOURNAL_MAX_ENTRIES_DEFAULT;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : JOURNAL_MAX_ENTRIES_DEFAULT;
}

/**
 * Append one entry. Returns true when written, false when disabled or on any
 * I/O failure — never throws. Observability must never block enforcement.
 */
export function appendJournalEntry(entry: GuardJournalEntry, options: AppendOptions = {}): boolean {
  const { cwd = process.cwd(), env = process.env } = options;
  if (env[JOURNAL_ENV_VAR]?.trim().toLowerCase() === 'off') {
    return false;
  }
  try {
    const path = journalPath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    rotateIfNeeded(path, resolveMaxEntries(env));
    const prevHash = readLastHash(path);
    const chained: GuardJournalEntry = { ...entry, prevHash, hash: chainHash(prevHash, entry) };
    appendFileSync(path, `${JSON.stringify(chained)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Parse journal lines tolerantly: malformed lines are skipped, never fatal. */
export function parseJournal(text: string): GuardJournalEntry[] {
  const entries: GuardJournalEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Partial<GuardJournalEntry>;
      if (
        typeof parsed.tool === 'string' &&
        typeof parsed.subject === 'string' &&
        typeof parsed.action === 'string' &&
        typeof parsed.ruleId === 'string'
      ) {
        entries.push(parsed as GuardJournalEntry);
      }
    } catch {
      // skip malformed line
    }
  }
  return entries;
}
