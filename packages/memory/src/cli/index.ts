#!/usr/bin/env node
/**
 * ideal-harness-memory — memory CLI.
 *
 * Commands:
 *   mcp                    start the memory MCP server (stdio)
 *   query <dir> <query>    index a directory's source files, print a subgraph
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { runCli } from '@ideal-harness/core';
import { startMemoryMcp } from '../runtime/mcp.js';
import { CodeGraph } from '../structural/graph.js';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java']);
const SKIP = new Set(['node_modules', 'dist', 'dist-test', '.git', '.turbo']);

async function indexDir(graph: CodeGraph, dir: string): Promise<number> {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) {
        count += await indexDir(graph, full);
      }
    } else if (SOURCE_EXT.has(extname(entry.name))) {
      graph.addFile(full, await readFile(full, 'utf8'));
      count += 1;
    }
  }
  return count;
}

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case 'mcp':
      await startMemoryMcp();
      return 0;
    case 'query': {
      const [dir, ...queryParts] = rest;
      if (dir === undefined || queryParts.length === 0) {
        process.stderr.write('usage: ideal-harness-memory query <dir> <query...>\n');
        return 1;
      }
      await stat(dir);
      const graph = new CodeGraph();
      const files = await indexDir(graph, dir);
      const result = graph.querySubgraph(queryParts.join(' '));
      process.stderr.write(`[indexed ${files} files, ${graph.allNodes().length} symbols]\n`);
      process.stdout.write(`${result.text}\n`);
      return 0;
    }
    default:
      process.stdout.write('usage: ideal-harness-memory <mcp|query>\n');
      return command === undefined ? 1 : 0;
  }
}

runCli('ideal-harness-memory', main);
