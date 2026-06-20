/**
 * Content detection + compression orchestration.
 *
 * Routes a tool result to the right deterministic compressor, applies a token
 * gate (never return something that didn't actually shrink), and is idempotent:
 * already-compressed content (carrying a CCR marker) is left untouched. With a
 * CcrStore it stashes the original and appends a retrieval marker, making the
 * lossy step lossless end-to-end.
 */

import type { CcrStore } from './ccr.js';
import { isCompressed } from './ccr.js';
import { compressStackTrace } from './compressors/errors.js';
import { compressJsonArray } from './compressors/json.js';
import { compressLog } from './compressors/log.js';
import { estimateTokens } from './tokens.js';

export type CompressionMethod = 'none' | 'json-array' | 'log-rle' | 'stack-trace';

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

/** Compress a single tool result. Idempotent, token-gated, optionally recoverable via CCR. */
export function compressToolResult(content: string, options: CompressOptions = {}): CompressionResult {
  const originalTokens = estimateTokens(content);

  // Idempotency / frozen-floor: never recompress already-compressed content.
  if (isCompressed(content)) {
    return noop(content);
  }

  const candidate = bestCandidate(content);
  if (candidate === null) {
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
