import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withFileLock } from '../../src/core/runtime/lock.js';

async function withTmpDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ideal-harness-lock-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('withFileLock runs fn and releases the lock file afterward', async () => {
  await withTmpDir(async (dir) => {
    const lockPath = join(dir, 'state.json.lock');
    const ran = await withFileLock(lockPath, () => 'ok');
    assert.equal(ran, 'ok');
    assert.equal(existsSync(lockPath), false, 'lock file must not remain after fn completes');
  });
});

test('withFileLock releases the lock even when fn throws (try/finally, not just the happy path)', async () => {
  await withTmpDir(async (dir) => {
    const lockPath = join(dir, 'state.json.lock');
    await assert.rejects(
      withFileLock(lockPath, () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(existsSync(lockPath), false, 'a thrown error must not orphan the lock file');
  });
});

test('two concurrent withFileLock calls on the same path serialize instead of interleaving (no lost update)', async () => {
  await withTmpDir(async (dir) => {
    const statePath = join(dir, 'counter.json');
    writeFileSync(statePath, JSON.stringify({ count: 0 }));
    const lockPath = join(dir, 'counter.json.lock');

    // Simulates two concurrent "processes" each doing a real read-modify-write
    // cycle under the shared lock. Without the lock, this read-then-write
    // pattern is exactly the TOCTOU that loses an update; with it, both
    // increments must land.
    const increment = () =>
      withFileLock(lockPath, async () => {
        const current = JSON.parse(readFileSync(statePath, 'utf8')) as { count: number };
        // A deliberate delay between read and write widens the race window a
        // buggy (unlocked) implementation would fall into — proves the lock
        // is actually excluding the second caller, not just getting lucky on
        // timing.
        await sleep(5);
        writeFileSync(statePath, JSON.stringify({ count: current.count + 1 }));
      });

    await Promise.all(Array.from({ length: 10 }, () => increment()));

    const final = JSON.parse(readFileSync(statePath, 'utf8')) as { count: number };
    assert.equal(final.count, 10, 'every concurrent increment must be reflected — none silently lost');
  });
});

test('a stale lock (older than staleMs) is detected and cleared, not waited out', async () => {
  await withTmpDir(async (dir) => {
    const lockPath = join(dir, 'state.json.lock');
    // Simulate an abandoned lock from a crashed process: a lock file that
    // already exists, stamped far in the past.
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: Date.now() - 60_000 }));

    const start = Date.now();
    const result = await withFileLock(lockPath, () => 'acquired', { staleMs: 30_000 });
    const elapsed = Date.now() - start;

    assert.equal(result, 'acquired');
    // Should be near-instant (stale-clear + immediate retry), not the full
    // bounded-wait duration a genuinely-held lock would cost.
    assert.ok(elapsed < 500, `stale lock should clear fast, took ${elapsed}ms`);
  });
});

test('a lock file with corrupt/unreadable contents is treated as stale, never wedges forever', async () => {
  await withTmpDir(async (dir) => {
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'not valid json');
    const result = await withFileLock(lockPath, () => 'acquired', { staleMs: 30_000 });
    assert.equal(result, 'acquired');
  });
});

test('a genuinely held (non-stale) lock exhausts its bounded wait and throws a clear, actionable error', async () => {
  await withTmpDir(async (dir) => {
    const lockPath = join(dir, 'state.json.lock');
    // Fresh timestamp — NOT stale, simulating another process legitimately
    // mid-write right now.
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: Date.now() }));

    await assert.rejects(
      withFileLock(lockPath, () => 'never runs', { staleMs: 30_000, maxWaitAttempts: 3, retryDelayMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /could not acquire lock/);
        assert.match(error.message, new RegExp(lockPath.replace(/\\/g, '\\\\')));
        return true;
      },
    );
  });
});

test('withFileLock supports concurrent locks on DIFFERENT paths without blocking each other', async () => {
  await withTmpDir(async (dir) => {
    const lockA = join(dir, 'a.lock');
    const lockB = join(dir, 'b.lock');
    const order: string[] = [];
    const slow = withFileLock(lockA, async () => {
      await sleep(30);
      order.push('a');
    });
    const fast = withFileLock(lockB, async () => {
      order.push('b');
    });
    await Promise.all([slow, fast]);
    // 'b' should finish first since it's on an unrelated lock path and isn't
    // waiting behind 'a' — proves locks are per-path, not one global mutex.
    assert.deepEqual(order, ['b', 'a']);
  });
});
