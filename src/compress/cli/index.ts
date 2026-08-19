#!/usr/bin/env node
/**
 * ideal-harness-compress — compression CLI.
 *
 * Commands:
 *   mcp           start the compress MCP server (stdio)
 *   compress      compress stdin, print the result to stdout
 *
 * `compress` is one-way (see `--help`/USAGE below): CCR recovery needs a live
 * store shared between a stash and a later retrieve, and this CLI's `compress`
 * command has no `retrieve` counterpart — a marker printed here would exit
 * with the process and could never be redeemed by any later invocation. Wiring
 * up a store just to emit a dead-on-arrival marker would be less honest than
 * not emitting one; see `decisions.md` D035 and `ROADMAP.md` #13. Use the
 * `compress_tool_result`/`ccr_retrieve` MCP tools (a single long-lived
 * process) for recoverable compression.
 */

import { readStdin, runCli } from '../../core/index.js';
import { compressToolResult } from '../detect.js';
import { startCompressMcp } from '../runtime/mcp.js';

const USAGE = `usage: ideal-harness-compress <mcp|compress>
  mcp        start the compress MCP server (stdio) — compress_tool_result/ccr_retrieve, recoverable
  compress   read stdin, compress, write to stdout. ONE-WAY: no CCR recovery via the CLI
             (a CLI process exits before any later invocation could retrieve a stashed
             original — recoverable compression needs the mcp server's long-lived store)
`;

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
        `\n[${result.method}: ${result.originalTokens}→${result.compressedTokens} tokens, saved ${result.saved}, one-way — no CCR recovery via the CLI]\n`,
      );
      return 0;
    }
    case '-h':
    case '--help':
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stdout.write(USAGE);
      return command === undefined ? 1 : 0;
  }
}

runCli('ideal-harness-compress', main);
