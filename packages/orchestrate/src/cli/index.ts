#!/usr/bin/env node
/**
 * ideal-harness-orchestrate — orchestration CLI.
 *
 * Commands:
 *   mcp     start the orchestrate MCP server (stdio). Spend cap via IDEAL_HARNESS_SPEND_CAP.
 */

import { startOrchestrateMcp } from '../runtime/mcp.js';

async function main(): Promise<number> {
  const [, , command] = process.argv;
  switch (command) {
    case 'mcp':
      await startOrchestrateMcp();
      return 0;
    default:
      process.stdout.write('usage: ideal-harness-orchestrate <mcp>\n');
      return command === undefined ? 1 : 0;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`ideal-harness-orchestrate: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
