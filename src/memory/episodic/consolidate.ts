/**
 * Episodic consolidation — the decay half of the v0.3 flywheel (VISION §7).
 *
 * Without this, `EpisodicStore` grows forever: every session appends, nothing
 * ever leaves. Consolidation runs two passes, pure and deterministic:
 *
 *   1. Dedupe near-identical text (Jaccard overlap over BM25 tokens) — keeps
 *      the newer of any pair above the threshold.
 *   2. Prune low-signal records once the store exceeds `maxCount`, oldest
 *      first, but NEVER a `decision` / `failure` / `security_alert` — those
 *      are the durable record types this project's memory exists to keep.
 *
 * Never mutates its input; the caller decides whether/when to replace the
 * store's contents with the result.
 */

import { tokenize } from './bm25.js';
import type { Observation, ObservationType } from './store.js';

const PERMANENT_TYPES = new Set<ObservationType>(['decision', 'failure', 'security_alert']);

export interface ConsolidateOptions {
  /** Cap on total records kept after consolidation. */
  readonly maxCount?: number;
  /** Jaccard token-overlap at/above which two records are considered duplicates. */
  readonly dupOverlapThreshold?: number;
}

export interface ConsolidateResult {
  readonly kept: readonly Observation[];
  readonly dedupedCount: number;
  readonly prunedCount: number;
}

const DEFAULT_MAX_COUNT = 2000;
const DEFAULT_DUP_THRESHOLD = 0.85;

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const term of a) {
    if (b.has(term)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Pure consolidation over an observation list, oldest-first stable input. */
export function consolidate(observations: readonly Observation[], options: ConsolidateOptions = {}): ConsolidateResult {
  const maxCount = options.maxCount ?? DEFAULT_MAX_COUNT;
  const dupThreshold = options.dupOverlapThreshold ?? DEFAULT_DUP_THRESHOLD;

  // Pass 1: dedupe. Walk oldest → newest; a record is dropped only when a
  // STRICTLY NEWER record of the same type already covers its content, so
  // the newer of any duplicate pair always survives.
  const byRecency = [...observations].sort((a, b) => a.ts - b.ts);
  const tokenSets: ReadonlySet<string>[] = byRecency.map((o) => new Set(tokenize(o.text)));
  const dropped = new Set<number>();
  for (let i = 0; i < byRecency.length; i += 1) {
    if (dropped.has(i)) {
      continue;
    }
    const recordI = byRecency[i];
    const tokensI = tokenSets[i];
    if (recordI === undefined || tokensI === undefined) {
      continue;
    }
    for (let j = i + 1; j < byRecency.length; j += 1) {
      const recordJ = byRecency[j];
      const tokensJ = tokenSets[j];
      if (dropped.has(j) || recordJ === undefined || tokensJ === undefined || recordJ.type !== recordI.type) {
        continue;
      }
      if (jaccard(tokensI, tokensJ) >= dupThreshold) {
        dropped.add(i); // i is older (byRecency is ascending) — keep j
        break;
      }
    }
  }
  const deduped = byRecency.filter((_, i) => !dropped.has(i));
  const dedupedCount = observations.length - deduped.length;

  // Pass 2: prune to maxCount, oldest-first, permanent types exempt.
  if (deduped.length <= maxCount) {
    return { kept: deduped, dedupedCount, prunedCount: 0 };
  }
  const permanent = deduped.filter((o) => PERMANENT_TYPES.has(o.type));
  const prunable = deduped.filter((o) => !PERMANENT_TYPES.has(o.type)).sort((a, b) => b.ts - a.ts); // newest first
  const budget = Math.max(0, maxCount - permanent.length);
  const survivingPrunable = prunable.slice(0, budget);
  const prunedCount = prunable.length - survivingPrunable.length;
  const kept = [...permanent, ...survivingPrunable].sort((a, b) => a.ts - b.ts);
  return { kept, dedupedCount, prunedCount };
}
