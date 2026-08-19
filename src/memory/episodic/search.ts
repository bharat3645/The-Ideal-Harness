/**
 * Episodic recall = BM25 (or, when available, SQLite-FTS5 — see
 * `searchObservationsAsync`) relevance, optionally blended with a recency
 * boost and a lexical vector rerank. This is the fix for recency-only
 * memory: results are ranked by how well they match the query, and recency
 * is an optional, bounded tie-breaker — never the sole signal.
 */

import { Bm25Index, tokenize } from './bm25.js';
import { fts5Available, searchFts5 } from './fts5.js';
import type { Observation } from './store.js';
import { rerankByVectorSimilarity } from './vector-rerank.js';

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

/** Shared by both the sync (`searchObservations`) and async
 *  (`searchObservationsAsync`) paths: turn raw `{id, score}` hits from
 *  whichever first-stage retriever ran into final `SearchHit`s, applying the
 *  same recency blend either way so the two paths only ever differ in *which
 *  engine* found the candidates, never in how recency is weighted. */
function applyRecencyAndResolve(
  hits: readonly { id: string; score: number }[],
  byId: ReadonlyMap<string, Observation>,
  options: SearchOptions,
): SearchHit[] {
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

export function searchObservations(
  observations: readonly Observation[],
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const limit = options.limit ?? 10;

  // Degenerate query: if it tokenizes to nothing (e.g. only single-character
  // terms, which BM25 filters out), fall back to recency so the caller gets
  // *something* relevant rather than a silently empty result.
  if (tokenize(query).length === 0) {
    return [...observations]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
      .map((observation) => ({ observation, score: 0 }));
  }

  const index = new Bm25Index(observations.map((o) => ({ id: o.id, text: o.text })));
  const byId = new Map(observations.map((o) => [o.id, o]));
  return applyRecencyAndResolve(index.search(query, limit), byId, options);
}

export interface SearchOptionsAsync extends SearchOptions {
  /** Blend in TF-hashed cosine-similarity rerank (`vector-rerank.ts`) on top of the first-stage
   *  ranking. Default true — set false to get pure BM25/FTS5 term-overlap ranking only. */
  readonly vectorRerank?: boolean;
  readonly vectorRerankWeight?: number;
}

/**
 * Same contract as `searchObservations`, upgraded when the runtime supports
 * it: tries the SQLite-FTS5 backend (`fts5.ts`) first — a real database
 * engine's own indexed MATCH instead of an O(n) JS-level scan — and falls
 * back to the identical hand-rolled `Bm25Index` path `searchObservations`
 * uses when FTS5 isn't available on this Node version. Either way, a lexical
 * vector rerank (`vector-rerank.ts`) blends in afterward by default — see
 * that module's docblock for exactly what it does and does not capture.
 *
 * Always resolves; never throws on the FTS5 tier being absent, matching
 * every other optional-engine-tier contract in this codebase.
 */
export async function searchObservationsAsync(
  observations: readonly Observation[],
  query: string,
  options: SearchOptionsAsync = {},
): Promise<SearchHit[]> {
  const limit = options.limit ?? 10;

  if (tokenize(query).length === 0) {
    return [...observations]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
      .map((observation) => ({ observation, score: 0 }));
  }

  const byId = new Map(observations.map((o) => [o.id, o]));
  // Overfetch before recency/vector reranking narrows back down to `limit`, so
  // a candidate that's not top-`limit` on pure term-overlap alone still gets a
  // fair chance once recency/vector signals are blended in.
  const overfetch = limit * 3;

  const fts5Hits = await searchFts5(observations, query, overfetch);
  const firstStage =
    fts5Hits ?? new Bm25Index(observations.map((o) => ({ id: o.id, text: o.text }))).search(query, overfetch);

  let resolved = applyRecencyAndResolve(firstStage, byId, options);

  if (options.vectorRerank !== false && resolved.length > 0) {
    const textById = new Map(observations.map((o) => [o.id, o.text]));
    const rescored = rerankByVectorSimilarity(
      resolved.map((hit) => ({ id: hit.observation.id, score: hit.score })),
      query,
      textById,
      options.vectorRerankWeight === undefined ? {} : { weight: options.vectorRerankWeight },
    );
    const byResolvedId = new Map(resolved.map((hit) => [hit.observation.id, hit.observation]));
    resolved = rescored
      .map((r) => {
        const observation = byResolvedId.get(r.id);
        return observation === undefined ? undefined : { observation, score: r.score };
      })
      .filter((hit): hit is SearchHit => hit !== undefined);
  }

  return resolved.slice(0, limit);
}

/** True when this runtime can run the faster SQLite-FTS5 first-stage retriever. Never throws. */
export { fts5Available };
