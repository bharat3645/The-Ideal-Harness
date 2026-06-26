#!/usr/bin/env node
/**
 * ideal-harness-compress — compression CLI.
 *
 * Commands:
 *   mcp           start the compress MCP server (stdio)
 *   compress      compress stdin, print the result to stdout
 */

import { readStdin, runCli } from '../../core/index.js';
import { compressToolResult } from '../detect.js';
import { startCompressMcp } from '../runtime/mcp.js';

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

runCli('ideal-harness-compress', main);
