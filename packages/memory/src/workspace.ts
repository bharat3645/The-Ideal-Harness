/**
 * Workspace resolution — the memory-isolation boundary.
 *
 * Memory is scoped to exactly ONE workspace (one project). The server resolves
 * the workspace once at startup and binds to it for its whole life; no tool can
 * target another project, so a confused or injected model cannot reach another
 * repo's memory — the capability simply does not exist in the API.
 *
 * Persistence (v0.2) lives INSIDE the project at `<root>/.ideal-harness/memory/`,
 * never in `$HOME`, so the filesystem itself is the isolation boundary. When the
 * workspace cannot be resolved we run EPHEMERAL (no persistence) rather than fall
 * back to a shared store — the memory analogue of guard's deny-wins: when scope
 * is unknown, do not persist.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Workspace {
  /** Absolute project root, or null when unresolved (→ ephemeral). */
  readonly root: string | null;
  /** Stable namespace key, stamped on every record for defence-in-depth. */
  readonly key: string;
  /** Whether memory may persist to disk for this workspace. */
  readonly persistent: boolean;
  /** Where a persistent store lives (`<root>/.ideal-harness/memory`), or null. */
  readonly storeDir: string | null;
}

/** The fail-closed workspace: no root, no persistence, a fixed in-process key. */
export const EPHEMERAL_WORKSPACE: Workspace = {
  root: null,
  key: 'ephemeral',
  persistent: false,
  storeDir: null,
};

/** Normalize a git remote URL into a stable identity (scheme/credentials/suffix-insensitive). */
export function normalizeGitRemote(remote: string): string {
  let s = remote.trim().toLowerCase();
  s = s.replace(/^[a-z0-9._-]+@/, ''); // strip scp-style user@
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme://
  s = s.replace(':', '/'); // scp host:owner/repo → host/owner/repo
  s = s.replace(/\.git$/, '').replace(/\/+$/, '');
  return s;
}

/** Derive a deterministic workspace key: git identity if available, else a path hash. */
export function deriveWorkspaceKey(input: { gitRemote?: string | null; root: string }): string {
  if (input.gitRemote && input.gitRemote.trim().length > 0) {
    return `git:${normalizeGitRemote(input.gitRemote)}`;
  }
  const hash = createHash('sha256').update(input.root).digest('hex').slice(0, 16);
  return `path:${hash}`;
}

/**
 * Walk up from `startDir` to the first ancestor that looks like a project root
 * (`.git` or `.ideal-harness` marker). Pure over an injected predicate, so it is
 * testable without a filesystem. Returns null if no root is found.
 */
export function findWorkspaceRoot(startDir: string, isRootMarker: (dir: string) => boolean): string | null {
  let dir = startDir;
  for (let i = 0; i < 256; i += 1) {
    if (isRootMarker(dir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null; // reached the filesystem root with no marker
    }
    dir = parent;
  }
  return null;
}

/** Bind a Workspace from resolved inputs. Fail-closed: unresolved or disabled → ephemeral. */
export function bindWorkspace(input: { root: string | null; gitRemote?: string | null; enabled?: boolean }): Workspace {
  if (input.root === null || input.enabled === false) {
    return EPHEMERAL_WORKSPACE;
  }
  const key = deriveWorkspaceKey({ gitRemote: input.gitRemote ?? null, root: input.root });
  return {
    root: input.root,
    key,
    persistent: true,
    storeDir: join(input.root, '.ideal-harness', 'memory'),
  };
}

/** Best-effort read of `origin` from a checkout's `.git/config` (no git binary needed). */
function readGitRemote(root: string): string | null {
  try {
    const cfg = readFileSync(join(root, '.git', 'config'), 'utf8');
    const match = cfg.match(/\[remote "origin"\][\s\S]*?\burl\s*=\s*(.+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the live workspace from the process environment (impure; used by the
 * server at startup). `IDEAL_HARNESS_MEMORY=off` is a per-repo kill-switch.
 */
export function resolveWorkspace(startDir: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Workspace {
  if (env.IDEAL_HARNESS_MEMORY === 'off') {
    return EPHEMERAL_WORKSPACE;
  }
  const root = findWorkspaceRoot(
    startDir,
    (dir) => existsSync(join(dir, '.git')) || existsSync(join(dir, '.ideal-harness')),
  );
  if (root === null) {
    return bindWorkspace({ root: null });
  }
  return bindWorkspace({ root, gitRemote: readGitRemote(root) });
}
