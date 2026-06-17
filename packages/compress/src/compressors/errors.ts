/**
 * Error compression (12-factor #9: compress errors into context).
 *
 * A full stack trace is mostly noise; the cause and the top few frames carry
 * the signal. Collapse long traces to the error line + first frames + a count
 * of the rest, so a failure costs a few lines of context instead of dozens.
 */

const FRAME = /^\s*(?:at\s+|File\s+".*",\s*line\s+\d+)/;
const KEEP_FRAMES = 3;

export interface ErrorCompression {
  readonly text: string;
  readonly framesDropped: number;
}

/** Collapse long stack traces. Returns null when there is nothing to collapse. */
export function compressStackTrace(input: string): ErrorCompression | null {
  const lines = input.split('\n');
  const out: string[] = [];
  let framesDropped = 0;
  let i = 0;
  while (i < lines.length) {
    if (FRAME.test(lines[i] as string)) {
      let run = 0;
      while (i + run < lines.length && FRAME.test(lines[i + run] as string)) {
        run += 1;
      }
      if (run > KEEP_FRAMES + 1) {
        for (let k = 0; k < KEEP_FRAMES; k += 1) {
          out.push(lines[i + k] as string);
        }
        out.push(`    ... ${run - KEEP_FRAMES} more frames`);
        framesDropped += run - KEEP_FRAMES;
      } else {
        for (let k = 0; k < run; k += 1) {
          out.push(lines[i + k] as string);
        }
      }
      i += run;
    } else {
      out.push(lines[i] as string);
      i += 1;
    }
  }
  if (framesDropped === 0) {
    return null;
  }
  return { text: out.join('\n'), framesDropped };
}
