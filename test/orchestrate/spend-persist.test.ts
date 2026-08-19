import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveInitialSpend, writeSpendState } from '../../src/orchestrate/runtime/mcp.js';
import { parseSpendState, SpendGovernor, serializeSpendState } from '../../src/orchestrate/spend.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ih-spend-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('serializeSpendState / parseSpendState round-trip', () => {
  const json = serializeSpendState({ used: 4200, ts: 1700000000000 });
  const state = parseSpendState(json);
  assert.equal(state.used, 4200);
  assert.equal(state.ts, 1700000000000);
});

test('parseSpendState rejects a missing/invalid "used" field', () => {
  assert.throws(() => parseSpendState('{"ts": 1}'), /invalid spend state/);
  assert.throws(() => parseSpendState('{"used": -5, "ts": 1}'), /invalid spend state/);
  assert.throws(() => parseSpendState('{"used": "abc", "ts": 1}'), /invalid spend state/);
  assert.throws(() => parseSpendState('not json'));
});

test('SpendGovernor restores prior spend via initialUsed instead of starting at zero', () => {
  const spend = new SpendGovernor(1000, 800);
  assert.equal(spend.spent(), 800);
  assert.equal(spend.remaining(), 200);
  assert.equal(spend.check(300).allowed, false, 'restored spend must still gate against the cap');
});

test('SpendGovernor rejects an invalid initialUsed instead of silently disabling the cap', () => {
  assert.throws(() => new SpendGovernor(1000, Number('abc')), /invalid initial spend/);
  assert.throws(() => new SpendGovernor(1000, -1), /invalid initial spend/);
  assert.throws(() => new SpendGovernor(1000, Number.POSITIVE_INFINITY), /invalid initial spend/);
});

test('restart mid-session: spend survives an MCP server restart instead of resetting to zero', () => {
  withTmpDir((dir) => {
    const path = join(dir, 'orchestrate-spend.json');
    const capTokens = 1000;

    // "First boot": no state file yet, ledger is empty -> genuinely fresh, starts at 0.
    const firstBootUsed = resolveInitialSpend(path, capTokens, false);
    assert.equal(firstBootUsed, 0);
    assert.ok(existsSync(path), 'first boot must bootstrap-write a state file');

    // Session runs: spend 800 tokens, persisted after every record (mirrors the
    // mcp.ts spend_check handler calling persistSpend() after spend.record()).
    const spend1 = new SpendGovernor(capTokens, firstBootUsed);
    spend1.record(800);
    writeSpendState(path, spend1.spent());

    // "Restart": a fresh SpendGovernor is constructed the way startOrchestrateMcp()
    // does on a real restart -- resolveInitialSpend reads the persisted state back.
    const restoredUsed = resolveInitialSpend(path, capTokens, true);
    assert.equal(restoredUsed, 800, 'spend must survive the restart, not reset to zero');

    const spend2 = new SpendGovernor(capTokens, restoredUsed);
    assert.equal(spend2.remaining(), 200);
    assert.equal(spend2.check(300).allowed, false, 'a session that already spent 800/1000 must not get a fresh budget');
  });
});

test('corrupt spend state fails CLOSED (assumes cap already reached), not open to zero', () => {
  withTmpDir((dir) => {
    const path = join(dir, 'orchestrate-spend.json');
    writeFileSync(path, '{ this is not valid json');
    const capTokens = 1000;

    const used = resolveInitialSpend(path, capTokens, true);

    assert.equal(used, capTokens, 'corrupt state must fail closed to spent=cap, never spent=0');
    const spend = new SpendGovernor(capTokens, used);
    assert.equal(spend.check(1).allowed, false, 'no further spend allowed until a human resets deliberately');
    assert.ok(existsSync(`${path}.corrupt`), 'the corrupt file must be quarantined, not silently discarded');
    assert.ok(!existsSync(path), 'the corrupt path itself should no longer exist after quarantine');
  });
});

test('missing spend state on a workspace whose ledger already has tasks fails CLOSED, not open to zero', () => {
  withTmpDir((dir) => {
    const path = join(dir, 'orchestrate-spend.json');
    const capTokens = 500;

    // No state file at all, but the ledger already has tasks -- strong evidence a
    // prior session ran and its spend state was lost, not that this is a fresh workspace.
    const used = resolveInitialSpend(path, capTokens, true);

    assert.equal(used, capTokens, 'missing state on a non-empty ledger must fail closed to spent=cap');
    assert.ok(
      existsSync(path),
      'the fail-closed state must itself be persisted so it is stable across further restarts',
    );
  });
});

test('missing spend state on a genuinely fresh (empty-ledger) workspace starts at zero', () => {
  withTmpDir((dir) => {
    const path = join(dir, 'orchestrate-spend.json');
    const used = resolveInitialSpend(path, 1000, false);
    assert.equal(used, 0);
    const persisted = parseSpendState(readFileSync(path, 'utf8'));
    assert.equal(persisted.used, 0, 'the bootstrap write must be an explicit, valid used=0 state');
  });
});

test('missing spend state when uncapped is moot -- always starts at zero, never blocks', () => {
  withTmpDir((dir) => {
    const path = join(dir, 'orchestrate-spend.json');
    // Even with an existing ledger, an uncapped governor has nothing to fail closed against.
    const used = resolveInitialSpend(path, null, true);
    assert.equal(used, 0);
  });
});

test('deliberate reset (spend reset semantics): an explicit used=0 state is honored, not treated as corrupt/missing', () => {
  withTmpDir((dir) => {
    const path = join(dir, 'orchestrate-spend.json');
    // Simulates `ideal-harness-orchestrate spend reset`, which writes an explicit
    // {used: 0} state rather than deleting the file -- deletion would be indistinguishable
    // from the fail-closed "lost state" case above.
    writeSpendState(path, 0);
    const used = resolveInitialSpend(path, 1000, true);
    assert.equal(used, 0, 'a deliberate, explicit reset must be honored even though the ledger has tasks');
  });
});
