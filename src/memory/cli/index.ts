#!/usr/bin/env node
/**
 * ideal-harness-memory — memory CLI.
 *
 * Commands:
 *   mcp                       start the memory MCP server (stdio)
 *   query <dir> <query>       index a directory's source files, print a subgraph
 *   vault-export <vaultDir>   export this workspace's episodic memory as Markdown notes (human-triggered only)
 *   vault-import <vaultDir> [--merge]
 *                             read candidate notes back; prints them, or with --merge writes new ones into the store
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { runCli } from '../../core/index.js';
import { exportToVault, importFromVault } from '../bridge/obsidian.js';
import { loadEpisodicSnapshot, saveEpisodicSnapshot } from '../episodic/persist.js';
import { startMemoryMcp } from '../runtime/mcp.js';
import { CodeGraph } from '../structural/graph.js';
import { resolveWorkspace } from '../workspace.js';

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
      await graph.addFileAuto(full, await readFile(full, 'utf8'));
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
      const sets = graph.fileSymbolSets();
      const treeSitterCount = sets.filter((s) => s.tier === 'treesitter').length;
      process.stderr.write(
        `[indexed ${files} files, ${graph.allNodes().length} symbols -- ${treeSitterCount}/${sets.length} files at tree-sitter tier, rest regex]\n`,
      );
      process.stdout.write(`${result.text}\n`);
      return 0;
    }
    case 'vault-export': {
      const vaultDir = rest[0];
      if (vaultDir === undefined) {
        process.stderr.write('usage: ideal-harness-memory vault-export <vaultDir>\n');
        return 1;
      }
      const ws = resolveWorkspace();
      if (!ws.persistent || ws.storeDir === null) {
        process.stdout.write('workspace has no persisted memory to export (ephemeral workspace)\n');
        return 0;
      }
      const store = loadEpisodicSnapshot(ws.storeDir, ws.key);
      const result = exportToVault(store.all(), { vaultDir });
      process.stdout.write(
        `${JSON.stringify({ written: result.written, unchanged: result.unchanged, total: result.files.length })}\n`,
      );
      return 0;
    }
    case 'vault-import': {
      const vaultDir = rest[0];
      if (vaultDir === undefined) {
        process.stderr.write('usage: ideal-harness-memory vault-import <vaultDir> [--merge]\n');
        return 1;
      }
      const merge = rest.includes('--merge');
      const { candidates, skipped } = importFromVault({ vaultDir });
      if (!merge) {
        process.stdout.write(`${JSON.stringify({ candidates, skipped: skipped.length }, null, 2)}\n`);
        process.stderr.write('dry run: pass --merge to actually write new observations into this workspace\n');
        return 0;
      }
      const ws = resolveWorkspace();
      if (!ws.persistent || ws.storeDir === null) {
        process.stdout.write('workspace has no persistent memory to merge into (ephemeral workspace)\n');
        return 0;
      }
      const store = loadEpisodicSnapshot(ws.storeDir, ws.key);
      const existingIds = new Set(store.all().map((o) => o.id));
      let added = 0;
      for (const candidate of candidates) {
        if (existingIds.has(candidate.observation.id)) {
          continue;
        }
        store.add(candidate.observation);
        added += 1;
      }
      saveEpisodicSnapshot(store, ws.storeDir);
      process.stdout.write(
        `${JSON.stringify({ added, alreadyPresent: candidates.length - added, skipped: skipped.length })}\n`,
      );
      return 0;
    }
    default:
      process.stdout.write('usage: ideal-harness-memory <mcp|query|vault-export|vault-import>\n');
      return command === undefined ? 1 : 0;
  }
}

runCli('ideal-harness-memory', main);
