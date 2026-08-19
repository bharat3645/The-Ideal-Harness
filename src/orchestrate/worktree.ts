/**
 * Parallel worktree fan-out — path-scoped writes for concurrent task
 * execution (VISION §7, v0.4 "scale-out").
 *
 * Each fanned-out task gets its own `git worktree`, so N implementer agents
 * can work concurrently without colliding on the same files: worktree
 * isolation IS the path-scoping, for free, using a mechanism git already
 * guarantees rather than inventing a new one. Worktrees live under
 * `.ideal-harness/worktrees/<id>` — already gitignored, self-contained in the
 * project, and reversible (`git worktree remove` / branch delete undo it
 * cleanly, unlike a destructive filesystem operation).
 *
 * Fixed argv, never a shell string: every git invocation here passes an
 * argument array straight to `spawn`, so there is no shell-injection surface
 * to gate the way `verify.ts` has to gate an arbitrary command string. Two
 * inputs are untrusted (model-supplied): the worktree `id`, validated to a
 * safe charset before it ever touches a path or branch name, and `baseRef`
 * (issue #10) — unvalidated in content, but a `--` separator is placed
 * immediately before it in the `git worktree add` argv so it can never be
 * parsed as an option/flag regardless of what it starts with, even though it
 * is never passed through a shell.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface WorktreeInfo {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
}

export interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

export function isValidWorktreeId(id: string): boolean {
  return VALID_ID.test(id) && id.length > 0 && id.length <= 80;
}

export function worktreesRoot(cwd: string = process.cwd()): string {
  return join(cwd, '.ideal-harness', 'worktrees');
}

function runGit(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }));
    child.on('error', (error) => resolve({ ok: false, stdout, stderr: `${stderr}\n${error.message}` }));
  });
}

export interface CreateWorktreeOptions {
  readonly cwd?: string;
  /** Ref to branch the new worktree from. Defaults to HEAD. */
  readonly baseRef?: string;
}

export interface CreateWorktreeResult extends GitResult {
  readonly info?: WorktreeInfo;
}

/** Create a new worktree + branch for one fanned-out task. */
export async function createWorktree(id: string, options: CreateWorktreeOptions = {}): Promise<CreateWorktreeResult> {
  if (!isValidWorktreeId(id)) {
    return { ok: false, stdout: '', stderr: `invalid worktree id "${id}": use only [a-zA-Z0-9_-], max 80 chars` };
  }
  const cwd = options.cwd ?? process.cwd();
  const baseRef = options.baseRef ?? 'HEAD';
  const path = join(worktreesRoot(cwd), id);
  const branch = `ideal-harness/${id}`;
  // `--` terminates option parsing unambiguously: a `baseRef` starting with
  // `-` (e.g. an accidental or adversarial flag-shaped value) is guaranteed to
  // land as the literal ref argument, never as a git option. See issue #10.
  const result = await runGit(['worktree', 'add', '-b', branch, path, '--', baseRef], cwd);
  return { ...result, ...(result.ok ? { info: { id, path, branch } } : {}) };
}

/** List worktrees this module created (under `.ideal-harness/worktrees/`), ignoring the primary checkout and any others. */
export async function listWorktrees(cwd: string = process.cwd()): Promise<WorktreeInfo[]> {
  const result = await runGit(['worktree', 'list', '--porcelain'], cwd);
  if (!result.ok) {
    return [];
  }
  // Match by a content marker rather than a reconstructed prefix: `git`
  // normalizes worktree paths to forward slashes in its porcelain output,
  // and on Windows a drive letter's casing can differ from how Node joined
  // the path, so a literal prefix comparison is fragile. `git worktree list`
  // only ever reports worktrees registered to THIS repo, so the marker alone
  // is enough to identify ours (the primary checkout never contains it).
  const marker = '/.ideal-harness/worktrees/';
  const infos: WorktreeInfo[] = [];
  for (const block of result.stdout.split(/\r?\n\r?\n/)) {
    const pathMatch = block.match(/^worktree (.+)$/m);
    if (pathMatch === null) {
      continue;
    }
    const rawPath = pathMatch[1] as string;
    const normalized = rawPath.replace(/\\/g, '/');
    const markerIndex = normalized.toLowerCase().indexOf(marker);
    if (markerIndex === -1) {
      continue; // not one of ours (e.g. the primary checkout itself)
    }
    const branchMatch = block.match(/^branch refs\/heads\/(.+)$/m);
    infos.push({
      id: normalized.slice(markerIndex + marker.length),
      path: rawPath,
      branch: (branchMatch?.[1] as string) ?? '',
    });
  }
  return infos;
}

export interface RemoveWorktreeOptions {
  readonly cwd?: string;
  readonly force?: boolean;
  /** Also delete the branch git created for it. Default true — leaving orphan branches behind is its own kind of mess. */
  readonly deleteBranch?: boolean;
}

/** Remove a worktree (and, by default, the branch it was created with). */
export async function removeWorktree(id: string, options: RemoveWorktreeOptions = {}): Promise<GitResult> {
  if (!isValidWorktreeId(id)) {
    return { ok: false, stdout: '', stderr: `invalid worktree id "${id}"` };
  }
  const cwd = options.cwd ?? process.cwd();
  const path = join(worktreesRoot(cwd), id);
  const args = ['worktree', 'remove', path, ...(options.force === true ? ['--force'] : [])];
  const result = await runGit(args, cwd);
  if (result.ok && options.deleteBranch !== false) {
    await runGit(['branch', '-D', `ideal-harness/${id}`], cwd);
  }
  return result;
}
