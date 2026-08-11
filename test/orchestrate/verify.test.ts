import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PolicyRule } from '../../src/guard/policy/types.js';
import { runVerify } from '../../src/orchestrate/verify.js';

const ALLOW_NODE: PolicyRule = { id: 'test-allow-node', action: 'allow', tool: 'Bash', match: '^node -e' };

test('runVerify refuses to run when the policy decision is not allow (default floor asks for arbitrary Bash)', async () => {
  const result = await runVerify({ command: 'node -e "console.log(1)"' });
  assert.equal(result.ran, false);
  assert.equal(result.ok, false);
  assert.notEqual(result.decision.action, 'allow');
});

test('runVerify actually executes an explicitly-allowed command and reports a real exit code', async () => {
  const result = await runVerify(
    { command: 'node -e "console.log(\'hello from verify\')"' },
    { policyTiers: [[ALLOW_NODE]] },
  );
  assert.equal(result.ran, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /hello from verify/);
});

test('runVerify reports ok:false on a non-zero exit code', async () => {
  const result = await runVerify({ command: 'node -e "process.exit(1)"' }, { policyTiers: [[ALLOW_NODE]] });
  assert.equal(result.ran, true);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
});

test('runVerify checks `expect` as a case-insensitive substring of the output', async () => {
  const ok = await runVerify(
    { command: 'node -e "console.log(\'All Tests Passed\')"', expect: 'all tests passed' },
    { policyTiers: [[ALLOW_NODE]] },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.expectMatched, true);

  const missing = await runVerify(
    { command: 'node -e "console.log(\'nothing relevant\')"', expect: 'all tests passed' },
    { policyTiers: [[ALLOW_NODE]] },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.expectMatched, false);
});

test('runVerify honors a timeout and reports timedOut', async () => {
  const result = await runVerify(
    { command: 'node -e "setTimeout(() => {}, 5000)"' },
    { policyTiers: [[ALLOW_NODE]], timeoutMs: 200 },
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
});

test('runVerify never runs a command that policy denies outright', async () => {
  const DENY_ALL: PolicyRule = { id: 'test-deny-all', action: 'deny', tool: 'Bash' };
  const result = await runVerify({ command: 'node -e "console.log(1)"' }, { policyTiers: [[DENY_ALL]] });
  assert.equal(result.ran, false);
  assert.equal(result.decision.action, 'deny');
});
