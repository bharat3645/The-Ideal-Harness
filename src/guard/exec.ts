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
 * Kill a spawned command's whole process tree, not just the immediate child.
 * `child.kill()` alone only signals the direct child — with `shell: true` (or
 * a sandboxed `/bin/sh -c` wrapper) that's the shell, not whatever it
 * launched, so a hung real command would keep running past the timeout. On
 * POSIX the child is spawned `detached` so it leads its own process group;
 * signalling `-pid` kills the whole group. On Windows there is no such group,
 * so `taskkill /T` (kill the tree) is the documented equivalent.
 */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } catch {
      // best-effort; nothing more we can do
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // best-effort; nothing more we can do
    }
  }
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
