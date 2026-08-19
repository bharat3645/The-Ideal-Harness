import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rerankByVectorSimilarity } from '../../src/memory/episodic/vector-rerank.js';

test('rerankByVectorSimilarity boosts a document whose term distribution closely matches the query', () => {
  const hits = [
    { id: 'weak-match', score: 1 },
    { id: 'strong-match', score: 1 },
  ];
  const textById = new Map([
    ['weak-match', 'completely unrelated content about lunch options'],
    ['strong-match', 'billing database connection pool leak fixed in the billing database'],
  ]);
  const reranked = rerankByVectorSimilarity(hits, 'billing database connection pool', textById);
  assert.equal(reranked[0]?.id, 'strong-match');
});

test('rerankByVectorSimilarity is deterministic across repeated calls', () => {
  const hits = [
    { id: 'a', score: 0.8 },
    { id: 'b', score: 0.6 },
  ];
  const textById = new Map([
    ['a', 'cache invalidation strategy'],
    ['b', 'session token authentication'],
  ]);
  const first = rerankByVectorSimilarity(hits, 'cache strategy', textById);
  const second = rerankByVectorSimilarity(hits, 'cache strategy', textById);
  assert.deepEqual(first, second);
});

test('rerankByVectorSimilarity leaves score unchanged (weight=0) as a sanity check on the blend formula', () => {
  const hits = [{ id: 'a', score: 1.5 }];
  const textById = new Map([['a', 'anything at all']]);
  const reranked = rerankByVectorSimilarity(hits, 'query', textById, { weight: 0 });
  assert.equal(reranked[0]?.score, 1.5);
});

test('rerankByVectorSimilarity passes through a hit with no matching text unchanged', () => {
  const hits = [{ id: 'missing', score: 1 }];
  const textById = new Map<string, string>();
  const reranked = rerankByVectorSimilarity(hits, 'query', textById);
  assert.deepEqual(reranked, hits);
});

test('rerankByVectorSimilarity never produces NaN/Infinity scores for empty or degenerate text', () => {
  const hits = [{ id: 'empty', score: 1 }];
  const textById = new Map([['empty', '']]);
  const reranked = rerankByVectorSimilarity(hits, '', textById);
  assert.ok(Number.isFinite(reranked[0]?.score));
});

test("rerankByVectorSimilarity: a higher weight amplifies the vector signal's effect on ranking", () => {
  const hits = [
    { id: 'a', score: 1 },
    { id: 'b', score: 1.01 }, // starts marginally ahead
  ];
  const textById = new Map([
    ['a', 'database connection pool billing database billing'],
    ['b', 'completely unrelated lunch topic'],
  ]);
  const lowWeight = rerankByVectorSimilarity(hits, 'billing database', textById, { weight: 0.01 });
  const highWeight = rerankByVectorSimilarity(hits, 'billing database', textById, { weight: 5 });
  // At a high enough weight, the strongly-matching but originally-behind 'a' overtakes 'b'.
  assert.equal(highWeight[0]?.id, 'a');
  // At a near-zero weight, the tiny original score gap decides it instead.
  assert.equal(lowWeight[0]?.id, 'b');
});
