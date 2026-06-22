/**
 * Shared CLI runtime helpers used by every The Ideal Harness package's bin.
 *
 * These centralize boilerplate that was copy-pasted across all five CLIs:
 *   - readStdin: drain stdin to a UTF-8 string (for pipe-driven commands).
 *   - runCli:    standard async-main bootstrap — set process.exitCode from the
 *                returned code, and on an uncaught error print "<name>: <message>"
 *                to stderr and exit non-zero.
 */

/** Drain a readable stream (stdin by default) to a single UTF-8 string. */
export async function readStdin(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Run a CLI's async `main`, mapping its return code to process.exitCode and
 * funneling any uncaught error to stderr as "<name>: <message>" with exit 1.
 * `name` is the CLI's program name used to prefix error output.
 */
export function runCli(name: string, main: () => Promise<number>): void {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
