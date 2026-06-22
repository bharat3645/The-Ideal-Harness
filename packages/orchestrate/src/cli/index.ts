#!/usr/bin/env node
/**
 * ideal-harness-orchestrate — orchestration CLI.
 *
 * Commands:
 *   mcp     start the orchestrate MCP server (stdio). Spend cap via IDEAL_HARNESS_SPEND_CAP.
 */

import { runCli } from '@ideal-harness/core';
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

runCli('ideal-harness-orchestrate', main);
