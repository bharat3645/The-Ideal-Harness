import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type TieredSourceSymbols,
  verifyPlan,
  verifyPlanStructural,
  verifySymbol,
  verifySymbolStructural,
} from '../../src/guard/drift.js';

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

const TREESITTER_SOURCES: TieredSourceSymbols[] = [
  { path: 'a.ts', names: ['doThing'], tier: 'treesitter' },
  { path: 'b.ts', names: ['helperValue'], tier: 'treesitter' },
];

test('verifySymbolStructural finds a symbol and reports treesitter authority when every source parsed at that tier', () => {
  const verdict = verifySymbolStructural('doThing', TREESITTER_SOURCES);
  assert.equal(verdict.found, true);
  assert.equal(verdict.authority, 'treesitter');
  assert.deepEqual(verdict.matches, ['a.ts']);
});

test('verifySymbolStructural HARD-BLOCKS a missing symbol when every source was proven complete by tree-sitter', () => {
  const verdict = verifySymbolStructural('zzHallucinated', TREESITTER_SOURCES);
  assert.equal(verdict.found, false);
  assert.equal(verdict.authority, 'treesitter');
  assert.equal(verdict.hardBlock, true, 'a proven-absent symbol at treesitter tier must hard-block');
});

test('verifySymbolStructural refuses to hard-block when even one source fell back to the regex tier', () => {
  const mixed: TieredSourceSymbols[] = [...TREESITTER_SOURCES, { path: 'c.ts', names: [], tier: 'regex' }];
  const verdict = verifySymbolStructural('zzHallucinated', mixed);
  assert.equal(verdict.found, false);
  assert.equal(verdict.authority, 'grep', 'one regex-tier fallback caps the whole verdict at grep authority');
  assert.equal(verdict.hardBlock, false, 'a source we could not parse might still hide the symbol');
});

test('verifySymbolStructural with zero sources never hard-blocks (nothing was actually checked)', () => {
  const verdict = verifySymbolStructural('anything', []);
  assert.equal(verdict.found, false);
  assert.equal(verdict.authority, 'grep');
  assert.equal(verdict.hardBlock, false);
});

test('verifyPlanStructural returns one verdict per symbol', () => {
  const verdicts = verifyPlanStructural(['doThing', 'helperValue', 'ghost'], TREESITTER_SOURCES);
  assert.equal(verdicts.length, 3);
  assert.deepEqual(
    verdicts.map((v) => v.hardBlock),
    [false, false, true],
  );
});
