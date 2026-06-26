/**
 * JSON array compression via anomaly-preserving row sampling.
 *
 * Large homogeneous arrays (API results, row sets) are sampled: keep the head,
 * the tail, and EVERY anomalous row (errors, non-2xx statuses, error/warn
 * levels). Outliers are exactly what an agent needs, so they are never dropped.
 */

const HEAD = 3;
const TAIL = 2;
const MIN_ROWS = HEAD + TAIL + 2;

function isAnomalous(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) {
    return false;
  }
  const r = row as Record<string, unknown>;
  // `error: 0` is a success sentinel in many APIs (gRPC, syscalls, DB drivers),
  // so a zero error code is NOT an anomaly — only a truthy/non-empty error is.
  if ('error' in r && r.error !== null && r.error !== false && r.error !== '' && r.error !== 0) {
    return true;
  }
  const status = r.status ?? r.statusCode ?? r.code;
  if (typeof status === 'number' && (status < 200 || status >= 300)) {
    return true;
  }
  const level = typeof r.level === 'string' ? r.level.toLowerCase() : '';
  return level === 'error' || level === 'warn' || level === 'fatal' || level === 'critical';
}

export interface JsonCompression {
  readonly text: string;
  readonly omitted: number;
  readonly anomaliesKept: number;
}

/** Compress a top-level JSON array. Returns null when not worth compressing. */
export function compressJsonArray(value: unknown): JsonCompression | null {
  if (!Array.isArray(value) || value.length < MIN_ROWS) {
    return null;
  }
  const keptIndices = new Set<number>();
  for (let i = 0; i < HEAD; i += 1) {
    keptIndices.add(i);
  }
  for (let i = value.length - TAIL; i < value.length; i += 1) {
    keptIndices.add(i);
  }
  let anomaliesKept = 0;
  value.forEach((row, i) => {
    if (isAnomalous(row)) {
      if (!keptIndices.has(i)) {
        anomaliesKept += 1;
      }
      keptIndices.add(i);
    }
  });

  const omitted = value.length - keptIndices.size;
  if (omitted <= 0) {
    return null;
  }

  const kept = [...keptIndices].sort((a, b) => a - b).map((i) => value[i]);
  const payload = {
    _idealHarness: 'json-array-sampled',
    total: value.length,
    omitted,
    anomaliesKept,
    rows: kept,
  };
  return { text: JSON.stringify(payload), omitted, anomaliesKept };
}
