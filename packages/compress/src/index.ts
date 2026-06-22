/**
 * @ideal-harness/compress — context & token compression.
 *
 * Deterministic, prompt-cache-safe tool_result compression with multiple
 * tactics (JSON anomaly sampling, log RLE, stack-trace collapse), a token gate
 * so output only ever shrinks, and a Compress-Cache-Retrieve store that makes
 * the lossy step recoverable. Output-side terse mode ships as the caveman skill.
 */

export {
  type AnalyzeBudgetInput,
  analyzeBudget,
  type BudgetAnalysis,
  type BudgetZone,
  DANGER_RATIO,
  DEFAULT_WINDOW,
  FAST_DELTA,
  type FormatStatuslineOptions,
  formatStatusline,
  formatTokens,
  resolveWindow,
  WARN_RATIO,
} from './budget.js';
export { CCR_MARKER, CcrStore, isCompressed } from './ccr.js';
export { compressStackTrace, type ErrorCompression } from './compressors/errors.js';
export { compressJsonArray, type JsonCompression } from './compressors/json.js';
export { compressLog, type LogCompression } from './compressors/log.js';
export {
  type CacheBlock,
  type CompressionMethod,
  type CompressionResult,
  type CompressOptions,
  compressToolResult,
  frozenFloor,
} from './detect.js';
export { estimateTokens } from './tokens.js';
