/**
 * Code-graph persistence — the on-disk half of incremental indexing.
 *
 * `CodeGraph` itself stays dependency-free and I/O-free (serialize/parse are
 * pure); this module is the thin, fail-open fs boundary, matching the same
 * shape guard's journal uses: a path builder, a sync read, a sync write, and
 * every I/O failure caught and reported rather than thrown — a full disk or a
 * corrupt snapshot must degrade to "re-index from scratch," never crash the
 * server.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeGraph } from './graph.js';

/** Where a workspace's persisted graph snapshot lives, given its `storeDir` (see `workspace.ts`). */
export function graphSnapshotPath(storeDir: string): string {
  return join(storeDir, 'graph.json');
}

/**
 * Load a persisted graph. A missing snapshot returns an empty graph. A
 * corrupt one is quarantined (renamed `.corrupt`) rather than deleted, so it
 * survives for debugging, and the graph still starts clean instead of
 * repeating the same failure on every future load — never throws.
 */
export function loadGraphSnapshot(storeDir: string): CodeGraph {
  const path = graphSnapshotPath(storeDir);
  if (!existsSync(path)) {
    return new CodeGraph();
  }
  try {
    return CodeGraph.parse(readFileSync(path, 'utf8'));
  } catch {
    try {
      renameSync(path, `${path}.corrupt`);
    } catch {
      // best-effort quarantine; either way, fall through to a clean graph
    }
    return new CodeGraph();
  }
}

/**
 * Persist the graph. Writes to a temp file then renames over the target, so
 * a crash mid-write can never leave a torn snapshot. Returns true on
 * success, false on any I/O failure — never throws.
 */
export function saveGraphSnapshot(graph: CodeGraph, storeDir: string): boolean {
  try {
    mkdirSync(storeDir, { recursive: true });
    const path = graphSnapshotPath(storeDir);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, graph.serialize(), 'utf8');
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}
