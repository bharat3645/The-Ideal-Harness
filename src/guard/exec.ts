/**
 * Shared spawn-with-timeout-and-tree-kill helper. Originally lived only in
 * `orchestrate/verify.ts`; moved here (guard is the lower layer — orchestrate
 * already depends on guard, so the reverse import would be circular) so
 * `guard/vet/external.ts` can reuse the same Windows-safe process-tree
 * termination instead of re-solving it.
 */

import { spawn } from 'node:child_process';

export interface ExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Kill a process tree by pid, not just the one process — same tree-kill
 * contract `killTree` uses for a just-spawned child, but callable with only
 * a pid, for a process that may have been spawned in a completely different
 * invocation (e.g. `browse`'s daemon, tracked across calls by pid in a state
 * file, not by a live `ChildProcess` handle). On POSIX this assumes the
 * target was spawned `detached` (leads its own process group) the way
 * `execCommand` and `browse/daemon.ts` both spawn; `-pid` then signals the
 * whole group. On Windows there is no such group, so `taskkill /T` (kill the
 * tree) is the documented equivalent.
 */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } catch {
      // best-effort; nothing more we can do
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // best-effort; nothing more we can do
    }
  }
}

/** Kill a just-spawned child's whole process tree — see `killProcessTree` for why this exists as a pid-based primitive. */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    return;
  }
  killProcessTree(child.pid);
}

/** Run either a sandboxed argv or a raw shell string. Never throws — errors surface as exitCode null. */
export function execCommand(
  argv: readonly string[] | null,
  shellCommand: string | null,
  options: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const detached = process.platform !== 'win32';
    const child =
      argv !== null
        ? spawn(argv[0] as string, argv.slice(1), { cwd: options.cwd, env: options.env, detached })
        : spawn(shellCommand as string, { cwd: options.cwd, env: options.env, shell: true, detached });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
  });
}
