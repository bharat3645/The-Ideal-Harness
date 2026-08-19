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
 * `existsSync` then `readFileSync` is two syscalls, not one: a concurrent
 * writer's atomic rename can land in the gap between them, turning a
 * perfectly valid snapshot into a spurious `ENOENT` on the read (issue #17).
 * That is a transient race, not evidence of corruption, so it gets one
 * retry before being treated the same as "never existed" — never routed
 * into the corrupt-snapshot quarantine path, which is reserved for content
 * that actually fails to parse.
 */
function readIfExists(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    if (!existsSync(path)) {
      return null;
    }
    try {
      return readFileSync(path, 'utf8');
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw retryError;
    }
  }
}

/**
 * Load a persisted graph. A missing snapshot returns an empty graph. A
 * corrupt one — including one stamped for a different workspace, see
 * `CodeGraph.parse` — is quarantined (renamed `.corrupt`) rather than
 * deleted, so it survives for debugging, and the graph still starts clean
 * instead of repeating the same failure on every future load — never throws.
 *
 * `workspaceKey` should be the caller's currently-bound workspace (`ws.key`
 * from `workspace.ts`), matching how `loadEpisodicSnapshot` is called. A
 * snapshot with no workspace stamp at all (pre-#16 format) still loads —
 * only a *mismatched* stamp is treated as unsafe — but logs a warning so an
 * operator can see it's running on a legacy snapshot.
 */
export function loadGraphSnapshot(storeDir: string, workspaceKey: string = 'default'): CodeGraph {
  const path = graphSnapshotPath(storeDir);
  const raw = readIfExists(path);
  if (raw === null) {
    return new CodeGraph(workspaceKey);
  }
  try {
    const graph = CodeGraph.parse(raw, workspaceKey);
    warnIfLegacySnapshot(raw, path, workspaceKey);
    return graph;
  } catch (error) {
    console.warn(
      `[ideal-harness] memory: quarantining graph snapshot at ${path} (${error instanceof Error ? error.message : 'invalid snapshot'}) — starting a fresh graph instead of serving it`,
    );
    try {
      renameSync(path, `${path}.corrupt`);
    } catch {
      // best-effort quarantine; either way, fall through to a clean graph
    }
    return new CodeGraph(workspaceKey);
  }
}

/**
 * `CodeGraph.parse` stays pure/I/O-free (see its own docblock), so this I/O
 * boundary owns the operator-facing warning for a legacy (unstamped)
 * snapshot instead. Re-parsing here is cheap relative to a disk read and
 * keeps the pure/impure split clean rather than threading a "was legacy"
 * flag back out of `parse`'s return type.
 */
function warnIfLegacySnapshot(raw: string, path: string, workspaceKey: string): void {
  try {
    const shape = JSON.parse(raw) as { workspace?: unknown };
    if (shape.workspace === undefined) {
      console.warn(
        `[ideal-harness] memory: graph snapshot at ${path} has no workspace stamp (pre-#16 format) — loading as legacy, will be stamped "${workspaceKey}" on next save`,
      );
    }
  } catch {
    // already parsed successfully by CodeGraph.parse above; nothing to warn about
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
