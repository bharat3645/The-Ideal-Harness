#!/usr/bin/env node
/**
 * ideal-harness-compress — compression CLI.
 *
 * Commands:
 *   mcp           start the compress MCP server (stdio)
 *   compress      compress stdin, print the result to stdout
 */

import { compressToolResult } from '../detect.js';
import { startCompressMcp } from '../runtime/mcp.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const [, , command] = process.argv;
  switch (command) {
    case 'mcp':
      await startCompressMcp();
      return 0;
    case 'compress': {
      const result = compressToolResult(await readStdin());
      process.stdout.write(result.text);
      process.stderr.write(
        `\n[${result.method}: ${result.originalTokens}→${result.compressedTokens} tokens, saved ${result.saved}]\n`,
      );
      return 0;
    }
    default:
      process.stdout.write('usage: ideal-harness-compress <mcp|compress>\n');
      return command === undefined ? 1 : 0;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`ideal-harness-compress: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
