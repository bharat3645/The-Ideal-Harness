import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bm25Index } from '../src/episodic/bm25.js';
import { searchObservations } from '../src/episodic/search.js';
import { EpisodicStore, parseObservations } from '../src/episodic/store.js';

test('BM25 ranks the most relevant document first', () => {
  const index = new Bm25Index([
    { id: 'a', text: 'the cache stores results for sixty seconds' },
    { id: 'b', text: 'authentication uses a session token' },
    { id: 'c', text: 'cache invalidation strategy and cache keys' },
  ]);
  const results = index.search('cache');
  assert.equal(results[0]?.id, 'c'); // two cache mentions outrank one
  assert.ok(results.every((r) => r.score > 0));
});

test('parseObservations reads the claude-mem XML contract', () => {
  const xml =
    '<observation type="bugfix" ts="1000">fixed null deref in auth.ts</observation>\n<observation>plain note</observation>';
  const parsed = parseObservations(xml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.type, 'bugfix');
  assert.equal(parsed[0]?.ts, 1000);
  assert.equal(parsed[1]?.type, 'note');
});

test('episodic search ranks by relevance, not recency', () => {
  const store = new EpisodicStore();
  store.add({ type: 'decision', text: 'chose postgres for the billing database', ts: 1 });
  store.add({ type: 'note', text: 'lunch options near the office', ts: 1000 }); // newer but irrelevant
  store.add({ type: 'bugfix', text: 'billing database connection pool leak fixed', ts: 2 });
  const hits = searchObservations(store.all(), 'billing database', { now: 2000, recencyHalfLifeMs: 100 });
  assert.ok(hits.length >= 2);
  // The newer-but-irrelevant note must not top relevant billing results.
  assert.notEqual(hits[0]?.observation.text, 'lunch options near the office');
});

test('a query with no indexable terms falls back to recency, not empty', () => {
  const store = new EpisodicStore();
  store.add({ type: 'note', text: 'older note', ts: 1 });
  store.add({ type: 'note', text: 'newer note', ts: 100 });
  // 'a' / 'is' tokenize away (single chars / stripped) -> degenerate query.
  const hits = searchObservations(store.all(), 'a', { limit: 5 });
  assert.equal(hits.length, 2, 'should return observations rather than nothing');
  assert.equal(hits[0]?.observation.text, 'newer note', 'most recent first');
});
