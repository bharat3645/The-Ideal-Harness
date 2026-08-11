import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PolicyRule } from '../../src/guard/policy/types.js';
import { fetchPackageDocs } from '../../src/web/docs.js';

test('fetchPackageDocs refuses to run when the WebFetch policy decision is not allow', async () => {
  const result = await fetchPackageDocs('lodash');
  assert.equal(result.ran, false);
  assert.notEqual(result.decision.action, 'allow');
});

test('fetchPackageDocs rejects an invalid package name even when policy would allow it', async () => {
  const ALLOW_ALL: PolicyRule = { id: 'test-allow', action: 'allow', tool: 'WebFetch' };
  const result = await fetchPackageDocs('../not a package', { policyTiers: [[ALLOW_ALL]] });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /invalid package name/);
});

test('fetchPackageDocs accepts scoped package names as valid', async () => {
  const DENY_ALL: PolicyRule = { id: 'test-deny', action: 'deny', tool: 'WebFetch' };
  const result = await fetchPackageDocs('@modelcontextprotocol/sdk', { policyTiers: [[DENY_ALL]] });
  // Denied by policy (not "invalid package name") proves the name itself passed validation.
  assert.equal(result.decision.action, 'deny');
  assert.notEqual(result.error, 'invalid package name');
});

test('fetchPackageDocs is refused outright by an explicit deny, same as the native tool would be', async () => {
  const DENY_ALL: PolicyRule = { id: 'test-deny', action: 'deny', tool: 'WebFetch' };
  const result = await fetchPackageDocs('lodash', { policyTiers: [[DENY_ALL]] });
  assert.equal(result.ran, false);
  assert.equal(result.decision.action, 'deny');
});
