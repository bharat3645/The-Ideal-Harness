/**
 * Lexical vector rerank — issue #19's second half, stated precisely so it is
 * never mistaken for more than it is.
 *
 * This is classical TF-style hashed-bag-of-words vectorization + cosine
 * similarity, computed over the same tokenizer `bm25.ts` uses — NOT a neural
 * or semantic embedding. It captures document-level term-distribution
 * overlap (two texts sharing many of the same relatively rare words score
 * high); it does not capture meaning — a synonym, a paraphrase, or a
 * conceptually related but differently-worded passage scores no better than
 * chance. That limitation is inherent to the technique, not an
 * implementation shortcoming, and this project's honesty rule means saying
 * so here rather than letting "vector rerank" imply a capability this
 * doesn't have. A real semantic embedding would need an actual model —
 * bundled weights (real bundle-size cost) or a network call to an embedding
 * API (breaks this project's offline-by-default posture and would need its
 * own policy gate) — neither fits what was approved for this pass.
 *
 * What this genuinely adds on top of pure BM25/FTS5 term-overlap ranking: a
 * second signal that rewards documents whose *overall* term distribution
 * resembles the query's, not just whether specific terms co-occur — useful
 * as a tie-breaker among BM25-close candidates. Zero dependency, pure math,
 * deterministic (no persisted vocabulary, no training step, nothing that can
 * drift between runs).
 */

import { tokenize } from './bm25.js';

/** Fixed hashing-trick bucket count. No vocabulary table to build or persist. */
const VECTOR_DIM = 512;

/** FNV-1a — fast, deterministic, no dependency. Collisions just blend two terms into one bucket. */
function hashTerm(term: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < term.length; i += 1) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % VECTOR_DIM;
}

function vectorize(text: string): Float64Array {
  const v = new Float64Array(VECTOR_DIM);
  for (const term of tokenize(text)) {
    const bucket = hashTerm(term);
    v[bucket] = (v[bucket] ?? 0) + 1;
  }
  return v;
}

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface VectorRerankOptions {
  /** Blend weight relative to the incoming score, same multiplicative-blend style `search.ts`'s
   *  recency boost already uses (`score * (1 + weight * signal)`), for one consistent pattern. */
  readonly weight?: number;
}

export interface Scored {
  readonly id: string;
  readonly score: number;
}

/**
 * Re-scores `hits` by blending in cosine similarity between the query and
 * each hit's own text (looked up via `textById`), preserving the original
 * scores' relative influence rather than replacing them outright — a hit
 * with a much stronger first-stage (BM25/FTS5) score stays ahead of a weak
 * one unless the vector signal is very strongly in the weak one's favor.
 * Hits with no matching text (should not happen in practice, defensive
 * only) pass through unchanged. Always returns re-sorted by the blended
 * score, descending.
 */
export function rerankByVectorSimilarity<T extends Scored>(
  hits: readonly T[],
  query: string,
  textById: ReadonlyMap<string, string>,
  options: VectorRerankOptions = {},
): T[] {
  const weight = options.weight ?? 0.3;
  const queryVector = vectorize(query);
  const rescored = hits.map((hit) => {
    const text = textById.get(hit.id);
    if (text === undefined) {
      return hit;
    }
    const similarity = cosineSimilarity(queryVector, vectorize(text));
    return { ...hit, score: hit.score * (1 + weight * similarity) };
  });
  return [...rescored].sort((a, b) => b.score - a.score);
}
