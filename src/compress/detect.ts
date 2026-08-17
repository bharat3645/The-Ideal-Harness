/**
 * Content detection + compression orchestration.
 *
 * Routes a tool result to the right deterministic compressor, applies a token
 * gate (never return something that didn't actually shrink), and is idempotent:
 * already-compressed content (carrying a CCR marker) is left untouched. With a
 * CcrStore it stashes the original and appends a retrieval marker, making the
 * lossy step lossless end-to-end.
 *
 * Cross-turn dedup (`dedupe` option) reuses that same CcrStore and the same
 * `<<ccr:HASH>>` marker/retrieval path — see decisions.md D039. It is a second
 * caller of one mechanism, not a second mechanism: exact content seen earlier
 * in the store's lifetime becomes a pointer to the first occurrence instead of
 * being re-emitted (or re-analyzed by the compression tactics below) a second
 * time. Exact-hash-match only, never fuzzy/similarity-based, and gated by the
 * same "only if the pointer is actually cheaper" rule the token gate already
 * enforces for compression.
 */

import type { CcrStore } from './ccr.js';
import { isCompressed } from './ccr.js';
import { compressStackTrace } from './compressors/errors.js';
import { compressJsonArray } from './compressors/json.js';
import { compressLog } from './compressors/log.js';
import { estimateTokens } from './tokens.js';

export type CompressionMethod = 'none' | 'json-array' | 'log-rle' | 'stack-trace' | 'dedup';

export interface CompressionResult {
  readonly text: string;
  readonly method: CompressionMethod;
  readonly originalTokens: number;
  readonly compressedTokens: number;
  /** Net tokens saved — already accounts for the retrieval-marker overhead. */
  readonly saved: number;
  readonly marker?: string;
  /** Token cost of the appended CCR marker (0 when not recoverable), for honest accounting. */
  readonly markerTokens?: number;
}

export interface CompressOptions {
  readonly store?: CcrStore;
  /** When true and a store is provided, stash the original and append a retrieval marker. */
  readonly recoverable?: boolean;
  /**
   * When true and a store is provided, exact-identical content seen earlier in
   * the store's lifetime becomes a pointer to the first occurrence instead of
   * being re-emitted. Session-scoped: the store's own lifetime is the dedup
   * scope, so two sessions (two CcrStore instances) never dedup against each
   * other. Exact-hash-match only — near-but-not-identical content is never
   * deduped.
   */
  readonly dedupe?: boolean;
}

function bestCandidate(content: string): { text: string; method: CompressionMethod } | null {
  // 1. JSON array → anomaly-preserving sampling.
  try {
    const parsed = JSON.parse(content);
    const json = compressJsonArray(parsed);
    if (json !== null) {
      return { text: json.text, method: 'json-array' };
    }
  } catch {
    // not JSON; fall through to text strategies
  }
  // 2. Text strategies: pick whichever shrinks more.
  const log = compressLog(content);
  const stack = compressStackTrace(content);
  const candidates: Array<{ text: string; method: CompressionMethod }> = [];
  if (log !== null) {
    candidates.push({ text: log.text, method: 'log-rle' });
  }
  if (stack !== null) {
    candidates.push({ text: stack.text, method: 'stack-trace' });
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((a, b) => (b.text.length < a.text.length ? b : a));
}

function noop(content: string): CompressionResult {
  const tokens = estimateTokens(content);
  return { text: content, method: 'none', originalTokens: tokens, compressedTokens: tokens, saved: 0 };
}

/** Compress a single tool result. Idempotent, token-gated, optionally recoverable via CCR and/or cross-turn deduped. */
export function compressToolResult(content: string, options: CompressOptions = {}): CompressionResult {
  const originalTokens = estimateTokens(content);

  // Idempotency / frozen-floor: never recompress already-compressed content.
  if (isCompressed(content)) {
    return noop(content);
  }

  const dedupeEnabled = options.dedupe === true && options.store !== undefined;

  // Cross-turn dedup: if this exact content was already stashed earlier in this
  // store's lifetime, point at the first occurrence instead of re-analyzing or
  // re-emitting it. Only worth it when the pointer is actually cheaper than the
  // content it replaces — the same "never return something that didn't shrink"
  // rule the compression token gate below already applies.
  if (dedupeEnabled) {
    const existing = (options.store as CcrStore).peekMarker(content);
    if (existing !== undefined) {
      const markerTokens = estimateTokens(existing);
      if (markerTokens < originalTokens) {
        return {
          text: existing,
          method: 'dedup',
          originalTokens,
          compressedTokens: markerTokens,
          saved: originalTokens - markerTokens,
          marker: existing,
          markerTokens,
        };
      }
      // Pointer isn't actually cheaper (tiny content) — not worth deduping,
      // fall through to the normal compression path below.
    }
  }

  const candidate = bestCandidate(content);
  if (candidate === null) {
    // Nothing to compress. Still memoize for future cross-turn dedup so a later
    // exact repeat of this content can point back here; the first occurrence
    // itself passes through unchanged.
    if (dedupeEnabled) {
      (options.store as CcrStore).stash(content);
    }
    return noop(content);
  }

  // Account for the retrieval-marker overhead in the token gate BEFORE stashing,
  // so a compression that only wins without the marker never strands an original
  // in the store. The preview marker is the exact length of a real one (16 hex).
  const willStash = options.recoverable === true && options.store !== undefined;
  const markerPreview = willStash ? '\n<<ccr:0000000000000000>>' : '';
  const gatedTokens = estimateTokens(candidate.text + markerPreview);
  // Token gate: only accept a real shrink (marker included).
  if (gatedTokens >= originalTokens) {
    if (dedupeEnabled) {
      (options.store as CcrStore).stash(content);
    }
    return noop(content);
  }

  let text = candidate.text;
  let marker: string | undefined;
  let markerTokens = 0;
  if (willStash) {
    // Safe to stash now: we have committed to returning the compressed result.
    marker = (options.store as CcrStore).stash(content);
    text = `${text}\n${marker}`;
    markerTokens = estimateTokens(`\n${marker}`);
  } else if (dedupeEnabled) {
    // Not recoverable, but still memoize the raw original (not the compressed
    // text) under the same hash so a later exact repeat of this content can be
    // deduped — the first occurrence's own output is unaffected.
    (options.store as CcrStore).stash(content);
  }

  const compressedTokens = estimateTokens(text);
  return {
    text,
    method: candidate.method,
    originalTokens,
    compressedTokens,
    saved: originalTokens - compressedTokens,
    ...(marker !== undefined ? { marker, markerTokens } : {}),
  };
}

export interface CacheBlock {
  readonly cacheControl?: boolean;
}

/**
 * Frozen-floor: number of leading blocks that are inside the prompt cache and
 * must NOT be modified. Mutating a cached prefix busts the cache, so the
 * compressor only operates on blocks at index >= this value.
 */
export function frozenFloor(blocks: readonly CacheBlock[]): number {
  let lastBreakpoint = -1;
  blocks.forEach((block, i) => {
    if (block.cacheControl === true) {
      lastBreakpoint = i;
    }
  });
  return lastBreakpoint + 1;
}
