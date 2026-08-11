/**
 * Episodic store persistence — same fail-open fs boundary as the code graph's
 * `structural/persist.ts`. `EpisodicStore` stays I/O-free (serialize/parse are
 * pure); this module is the thin sync read/write layer: a missing snapshot
 * starts empty, a corrupt one is quarantined (renamed `.corrupt`) rather than
 * deleted, and every write is atomic (temp file + rename) so a crash mid-write
 * can never leave a torn snapshot. Never throws.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EpisodicStore } from './store.js';

/** Where a workspace's persisted episodic snapshot lives, given its `storeDir` (see `workspace.ts`). */
export function episodicSnapshotPath(storeDir: string): string {
  return join(storeDir, 'episodic.json');
}

/** Load a persisted store. Missing → empty. Corrupt → quarantined, then empty. */
export function loadEpisodicSnapshot(storeDir: string, workspaceKey: string = 'default'): EpisodicStore {
  const path = episodicSnapshotPath(storeDir);
  if (!existsSync(path)) {
    return new EpisodicStore(workspaceKey);
  }
  try {
    return EpisodicStore.parse(readFileSync(path, 'utf8'), workspaceKey);
  } catch {
    try {
      renameSync(path, `${path}.corrupt`);
    } catch {
      // best-effort quarantine; either way, fall through to a clean store
    }
    return new EpisodicStore(workspaceKey);
  }
}

/** Persist the store atomically. Returns true on success, false on any I/O failure — never throws. */
export function saveEpisodicSnapshot(store: EpisodicStore, storeDir: string): boolean {
  try {
    mkdirSync(storeDir, { recursive: true });
    const path = episodicSnapshotPath(storeDir);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, store.serialize(), 'utf8');
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}
