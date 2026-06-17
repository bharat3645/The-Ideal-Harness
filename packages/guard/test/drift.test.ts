import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyPlan, verifySymbol } from '../src/drift.js';

const SOURCES = [
  { path: 'a.ts', content: 'export function doThing() { return 1; }' },
  { path: 'b.ts', content: 'export const helperValue = 42;' },
];

test('finds a defined symbol at grep tier', () => {
  const verdict = verifySymbol('doThing', SOURCES);
  assert.equal(verdict.found, true);
  assert.deepEqual(verdict.matches, ['a.ts']);
  assert.equal(verdict.authority, 'grep');
});

test('reports a missing symbol but never hard-blocks at grep tier', () => {
  const verdict = verifySymbol('nonexistentSymbol', SOURCES);
  assert.equal(verdict.found, false);
  // grep cannot prove absence, so it must not hard-block.
  assert.equal(verdict.hardBlock, false);
});

test('verifyPlan returns one verdict per symbol', () => {
  const verdicts = verifyPlan(['doThing', 'helperValue', 'ghost'], SOURCES);
  assert.equal(verdicts.length, 3);
  assert.deepEqual(
    verdicts.map((v) => v.found),
    [true, true, false],
  );
});
