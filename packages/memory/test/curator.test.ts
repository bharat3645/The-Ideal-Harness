import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileClaims } from '../src/curator.js';

test('keeps claims corroborated by tool-call evidence, rejects fabricated ones', () => {
  const evidence = [
    { tool: 'Edit', summary: 'edited auth.ts to add a null check on the session token' },
    { tool: 'Bash', summary: 'ran the auth test suite, all passing' },
  ];
  const result = reconcileClaims(
    ['added a null check on the session token in auth', 'deleted the entire billing module'],
    evidence,
  );
  const evidenced = result.find((r) => /null check/.test(r.claim));
  const fabricated = result.find((r) => /billing module/.test(r.claim));
  assert.equal(evidenced?.evidenced, true);
  assert.equal(evidenced?.matchedTool, 'Edit');
  assert.equal(fabricated?.evidenced, false);
});

test('empty claim is not evidenced', () => {
  const result = reconcileClaims(['   '], [{ tool: 'Read', summary: 'read a file' }]);
  assert.equal(result[0]?.evidenced, false);
});
