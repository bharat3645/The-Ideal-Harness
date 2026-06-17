/**
 * Log compression via template run-length encoding.
 *
 * Each line is reduced to a template (numbers, hex, UUIDs, ISO timestamps →
 * placeholders); consecutive lines with the same template collapse to a single
 * representative line plus a `(×N)` count. Repetitive logs are the canonical
 * tool-output bloat; their information content is "this happened N times".
 */

const SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<ts>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b\d+\b/g, '<n>'],
];

function templateOf(line: string): string {
  let t = line;
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    t = t.replace(pattern, replacement);
  }
  return t;
}

export interface LogCompression {
  readonly text: string;
  readonly collapsed: number;
}

/** Collapse consecutive same-template log lines. Returns null if nothing collapses. */
export function compressLog(input: string): LogCompression | null {
  const lines = input.split('\n');
  if (lines.length < 4) {
    return null;
  }
  const out: string[] = [];
  let collapsed = 0;
  let i = 0;
  while (i < lines.length) {
    const template = templateOf(lines[i] as string);
    let run = 1;
    while (i + run < lines.length && templateOf(lines[i + run] as string) === template) {
      run += 1;
    }
    out.push(run > 1 ? `${lines[i]} (×${run})` : (lines[i] as string));
    if (run > 1) {
      collapsed += run - 1;
    }
    i += run;
  }
  if (collapsed === 0) {
    return null;
  }
  return { text: out.join('\n'), collapsed };
}
