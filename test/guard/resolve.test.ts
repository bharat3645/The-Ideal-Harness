import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { grantLease } from '../../src/guard/leases.js';
import { evaluateTiered } from '../../src/guard/policy/engine.js';
import { consumeLeaseIfDecided, resolveOperatorTiers } from '../../src/guard/resolve.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ih-resolve-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveOperatorTiers with no policy/lease files falls back to just the default floor', () => {
  withTmpDir((dir) => {
    const { tiers, warnings } = resolveOperatorTiers({ cwd: dir });
    assert.equal(tiers.length, 1);
    assert.deepEqual(warnings, []);
    // WebFetch has no default allow rule, so an operator-less resolution still asks — this is
    // the exact gap that made ledger_verify/web_fetch permanently unusable before this file existed.
    const decision = evaluateTiered({ tool: 'WebFetch', input: { url: 'https://example.com' } }, tiers);
    assert.equal(decision.action, 'ask');
  });
});

test('resolveOperatorTiers picks up a project ideal-harness.policy.json allow rule', () => {
  withTmpDir((dir) => {
    writeFileSync(
      join(dir, 'ideal-harness.policy.json'),
      JSON.stringify({
        rules: [{ id: 'allow-docs-fetch', action: 'allow', tool: 'WebFetch', match: 'registry\\.npmjs\\.org' }],
      }),
    );
    const { tiers } = resolveOperatorTiers({ cwd: dir });
    const decision = evaluateTiered({ tool: 'WebFetch', input: { url: 'https://registry.npmjs.org/lodash' } }, tiers);
    assert.equal(decision.action, 'allow');
    assert.equal(decision.ruleId, 'allow-docs-fetch');
  });
});

test('resolveOperatorTiers picks up the shared team policy file', () => {
  withTmpDir((dir) => {
    mkdirSync(join(dir, '.ideal-harness'), { recursive: true });
    writeFileSync(
      join(dir, '.ideal-harness', 'team-policy.json'),
      JSON.stringify({ rules: [{ id: 'team-allow-ci', action: 'allow', tool: 'Bash', match: '^pnpm test$' }] }),
    );
    const { tiers } = resolveOperatorTiers({ cwd: dir });
    const decision = evaluateTiered({ tool: 'Bash', input: { command: 'pnpm test' } }, tiers);
    assert.equal(decision.action, 'allow');
    assert.equal(decision.ruleId, 'team-allow-ci');
  });
});

test('resolveOperatorTiers puts an active lease ahead of user/team/default', () => {
  withTmpDir((dir) => {
    const lease = grantLease({ tool: 'Bash', match: '^pnpm test', reason: 'ci run' }, dir, 0);
    const { tiers } = resolveOperatorTiers({ cwd: dir, now: 0 });
    const decision = evaluateTiered({ tool: 'Bash', input: { command: 'pnpm test' } }, tiers);
    assert.equal(decision.action, 'allow');
    assert.equal(decision.ruleId, `lease:${lease.id}`);
  });
});

test('consumeLeaseIfDecided only consumes when the decision actually came from a lease rule', () => {
  withTmpDir((dir) => {
    const lease = grantLease({ tool: 'Bash', match: '^pnpm test', reason: 'ci run', maxCalls: 1 }, dir, 0);
    consumeLeaseIfDecided({ action: 'deny', ruleId: 'some-default-rule', reason: 'x' }, dir);
    const { tiers } = resolveOperatorTiers({ cwd: dir, now: 0 });
    // Still live — the non-lease decision above must not have consumed it.
    const decision = evaluateTiered({ tool: 'Bash', input: { command: 'pnpm test' } }, tiers);
    assert.equal(decision.ruleId, `lease:${lease.id}`);

    consumeLeaseIfDecided(decision, dir);
    const { tiers: afterConsume } = resolveOperatorTiers({ cwd: dir, now: 0 });
    // maxCalls: 1, now used once — the lease must no longer be live.
    const decision2 = evaluateTiered({ tool: 'Bash', input: { command: 'pnpm test' } }, afterConsume);
    assert.notEqual(decision2.ruleId, `lease:${lease.id}`);
  });
});
