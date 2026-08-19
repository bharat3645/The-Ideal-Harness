import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fts5Available, searchFts5 } from '../../src/memory/episodic/fts5.js';
import type { Observation } from '../../src/memory/episodic/store.js';

const OBS: Observation[] = [
  { id: 'a', ts: 1, type: 'note', text: 'the cache stores results for sixty seconds', workspace: 'default' },
  { id: 'b', ts: 2, type: 'note', text: 'authentication uses a session token', workspace: 'default' },
  { id: 'c', ts: 3, type: 'note', text: 'cache invalidation strategy and cache keys', workspace: 'default' },
];

test('fts5Available never throws, regardless of runtime support', async () => {
  const result = await fts5Available();
  assert.equal(typeof result, 'boolean');
});

test('searchFts5 ranks the most relevant document first when the tier is available', async (t) => {
  if (!(await fts5Available())) {
    t.skip('node:sqlite / FTS5 not available on this runtime — expected on Node <22.5');
    return;
  }
  const hits = await searchFts5(OBS, 'cache', 10);
  assert.ok(hits !== null);
  assert.equal(hits[0]?.id, 'c'); // two cache mentions outrank one, same as the BM25 tier
  assert.ok(
    hits.every((h) => h.score > 0),
    "negated bm25() scores must be positive under this project's convention",
  );
});

test('searchFts5 returns null, not a throw, when the tier is genuinely unavailable', async (t) => {
  // Can't force node:sqlite to be absent on a runtime that has it, so this
  // only proves the *shape* of the contract (a real absence is exercised for
  // real by CI's Node 21 leg, which has no node:sqlite at all).
  if (!(await fts5Available())) {
    const hits = await searchFts5(OBS, 'cache', 10);
    assert.equal(hits, null);
  } else {
    t.skip("this runtime has FTS5 — the absence path is exercised by CI's Node 21 leg instead");
  }
});

test('searchFts5 handles a query containing FTS5 special syntax characters safely', async (t) => {
  if (!(await fts5Available())) {
    t.skip('node:sqlite / FTS5 not available on this runtime');
    return;
  }
  // A raw MATCH query with unbalanced quotes/operators would throw a SQLite
  // syntax error if not escaped — toFts5Query wraps every token as a literal
  // phrase specifically to prevent this.
  const hits = await searchFts5(OBS, 'cache "AND OR NOT (unbalanced', 10);
  assert.ok(Array.isArray(hits));
});

test('searchFts5 on an empty/degenerate query returns an empty array, not an error', async (t) => {
  if (!(await fts5Available())) {
    t.skip('node:sqlite / FTS5 not available on this runtime');
    return;
  }
  const hits = await searchFts5(OBS, '!!!', 10);
  assert.deepEqual(hits, []);
});

test('searchFts5 respects the limit', async (t) => {
  if (!(await fts5Available())) {
    t.skip('node:sqlite / FTS5 not available on this runtime');
    return;
  }
  const many: Observation[] = Array.from({ length: 20 }, (_, i) => ({
    id: `doc-${i}`,
    ts: i,
    type: 'note',
    text: 'shared relevant keyword appears here',
    workspace: 'default',
  }));
  const hits = await searchFts5(many, 'relevant', 5);
  assert.equal(hits?.length, 5);
});
