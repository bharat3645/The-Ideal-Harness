/**
 * Token estimation.
 *
 * A real tokenizer is model-specific and a heavy dependency; for compression
 * gating we only need a stable, monotonic estimate, so we use the well-known
 * ~4-chars-per-token heuristic. The compressor's token gate compares estimates
 * before/after, so the constant cancels out — only the ratio matters.
 */

export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}
