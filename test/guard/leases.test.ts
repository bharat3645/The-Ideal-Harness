import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  activeLeaseRules,
  consumeLease,
  grantLease,
  isLeaseLive,
  leaseToRule,
  loadLeases,
  pruneExpired,
  revokeLease,
  saveLeases,
} from '../../src/guard/leases.js';
import { DEFAULT_RULES } from '../../src/guard/policy/defaults.js';
import { evaluateTiered } from '../../src/guard/policy/engine.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ih-leases-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('isLeaseLive respects a time bound', () => {
  const lease = { id: 'x', tool: 'Bash', match: '^npm test', reason: 'r', grantedAt: 0, expiresAt: 1000, usedCalls: 0 };
  assert.equal(isLeaseLive(lease, 500), true);
  assert.equal(isLeaseLive(lease, 1000), false);
});

test('isLeaseLive respects a call-count bound', () => {
  const lease = { id: 'x', tool: 'Bash', match: '^npm test', reason: 'r', grantedAt: 0, maxCalls: 2, usedCalls: 2 };
  assert.equal(isLeaseLive(lease, 0), false);
});

test('a lease with neither bound is always live', () => {
  const lease = { id: 'x', tool: 'Bash', match: '^npm test', reason: 'r', grantedAt: 0, usedCalls: 0 };
  assert.equal(isLeaseLive(lease, 999_999_999), true);
});

test('pruneExpired drops only non-live leases', () => {
  const live = { id: 'a', tool: 'Bash', match: 'x', reason: 'r', grantedAt: 0, expiresAt: 2000, usedCalls: 0 };
  const dead = { id: 'b', tool: 'Bash', match: 'x', reason: 'r', grantedAt: 0, expiresAt: 500, usedCalls: 0 };
  assert.deepEqual(
    pruneExpired([live, dead], 1000).map((l) => l.id),
    ['a'],
  );
});

test('leaseToRule + activeLeaseRules build a working allow rule for evaluateTiered', () => {
  const lease = {
    id: 'bash-npm-test-1',
    tool: 'Bash',
    match: '^npm test',
    reason: 'debugging a flaky suite',
    grantedAt: 0,
    expiresAt: 10_000,
    usedCalls: 0,
  };
  const rule = leaseToRule(lease);
  assert.equal(rule.id, 'lease:bash-npm-test-1');
  assert.equal(rule.action, 'allow');
  const rules = activeLeaseRules([lease], 1000);
  assert.equal(rules.length, 1);
  const decision = evaluateTiered({ tool: 'Bash', input: { command: 'npm test --watch' } }, [rules, DEFAULT_RULES]);
  assert.equal(decision.action, 'allow');
  assert.equal(decision.ruleId, 'lease:bash-npm-test-1');
});

test('an expired lease no longer contributes an active rule', () => {
  const lease = { id: 'a', tool: 'Bash', match: '^npm test', reason: 'r', grantedAt: 0, expiresAt: 500, usedCalls: 0 };
  assert.deepEqual(activeLeaseRules([lease], 1000), []);
});

test('grantLease + loadLeases round-trip through the filesystem', () => {
  withTmpDir((dir) => {
    const lease = grantLease({ tool: 'Bash', match: '^npm test', reason: 'debugging', minutes: 30 }, dir, 0);
    assert.equal(lease.tool, 'Bash');
    assert.equal(lease.expiresAt, 30 * 60_000);
    const loaded = loadLeases(dir);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.id, lease.id);
  });
});

test('grantLease prunes already-expired leases when saving a new one', () => {
  withTmpDir((dir) => {
    saveLeases([{ id: 'old', tool: 'Bash', match: 'x', reason: 'r', grantedAt: 0, expiresAt: 100, usedCalls: 0 }], dir);
    grantLease({ tool: 'Bash', match: '^npm test', reason: 'debugging', minutes: 30 }, dir, 1000);
    const loaded = loadLeases(dir);
    assert.equal(loaded.length, 1);
    assert.notEqual(loaded[0]?.id, 'old');
  });
});

test('revokeLease removes a lease by id and reports whether one was found', () => {
  withTmpDir((dir) => {
    const lease = grantLease({ tool: 'Bash', match: '^npm test', reason: 'debugging' }, dir, 0);
    assert.equal(revokeLease(lease.id, dir), true);
    assert.equal(loadLeases(dir).length, 0);
    assert.equal(revokeLease(lease.id, dir), false);
  });
});

test('consumeLease increments usedCalls and eventually the lease stops being live', () => {
  withTmpDir((dir) => {
    const lease = grantLease({ tool: 'Bash', match: '^npm test', reason: 'debugging', maxCalls: 2 }, dir, 0);
    assert.equal(consumeLease(lease.id, dir, 0), true);
    assert.equal(loadLeases(dir)[0]?.usedCalls, 1);
    assert.equal(consumeLease(lease.id, dir, 0), true);
    assert.equal(activeLeaseRules(loadLeases(dir), 0).length, 0, 'lease exhausted its call budget');
  });
});

test('consumeLease on an unknown id returns false and leaves the file untouched', () => {
  withTmpDir((dir) => {
    grantLease({ tool: 'Bash', match: '^npm test', reason: 'debugging' }, dir, 0);
    assert.equal(consumeLease('no-such-id', dir, 0), false);
    assert.equal(loadLeases(dir).length, 1);
  });
});

test('loadLeases fails open to an empty list when the file is missing or corrupt', () => {
  withTmpDir((dir) => {
    assert.deepEqual(loadLeases(dir), []);
  });
});
