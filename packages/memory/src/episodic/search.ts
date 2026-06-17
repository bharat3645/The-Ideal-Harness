/**
 * Episodic recall = BM25 relevance, optionally blended with a recency boost.
 *
 * This is the fix for recency-only memory: results are ranked by how well they
 * match the query (BM25), and recency is an optional, bounded tie-breaker —
 * never the sole signal.
 */

import { Bm25Index } from './bm25.js';
import type { Observation } from './store.js';

export interface SearchOptions {
  readonly limit?: number;
  /** When set with `now`, adds a bounded recency boost (newer ranks slightly higher). */
  readonly recencyHalfLifeMs?: number;
  readonly now?: number;
  /** Optional weight of the recency boost relative to BM25 (default 0.25). */
  readonly recencyWeight?: number;
}

export interface SearchHit {
  readonly observation: Observation;
  readonly score: number;
}

export function searchObservations(
  observations: readonly Observation[],
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const index = new Bm25Index(observations.map((o) => ({ id: o.id, text: o.text })));
  const byId = new Map(observations.map((o) => [o.id, o]));
  const hits = index.search(query, options.limit ?? 10);

  const useRecency = options.recencyHalfLifeMs !== undefined && options.now !== undefined;
  const weight = options.recencyWeight ?? 0.25;

  const scored = hits.map((hit) => {
    const observation = byId.get(hit.id);
    if (observation === undefined) {
      return { observation: undefined, score: hit.score };
    }
    let score = hit.score;
    if (useRecency) {
      const age = Math.max(0, (options.now as number) - observation.ts);
      const recency = 0.5 ** (age / (options.recencyHalfLifeMs as number));
      score += weight * hit.score * recency;
    }
    return { observation, score };
  });

  return scored.filter((hit): hit is SearchHit => hit.observation !== undefined).sort((a, b) => b.score - a.score);
}
