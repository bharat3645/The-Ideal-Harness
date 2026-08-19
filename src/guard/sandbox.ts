/**
 * Sandbox command builder + subprocess env-scrub.
 *
 * Builds an OS-level sandbox wrapper (macOS Seatbelt, Linux bubblewrap) around
 * a command so filesystem/network restrictions bind every child process, not
 * just the model's file tools. On an unsupported platform it fails closed:
 * `ok: false`, and the caller must refuse to run rather than run unsandboxed.
 *
 * Windows research, issue #35 (`windowsJobObjectSupported` below): real,
 * verified primitives for Windows process containment, added as a
 * foundation for closing this gap -- NOT yet wired into
 * `buildSandboxCommand`, which still returns `ok: false` for `win32` exactly
 * as before. See the primitives' own docblock for why.
 */

import { spawnSync } from 'node:child_process';

export type Platform = 'darwin' | 'linux' | 'win32' | 'other';

export interface SandboxOptions {
  readonly workdir: string;
  readonly writablePaths?: readonly string[];
  readonly allowNetwork?: boolean;
}

export interface SandboxCommand {
  readonly ok: boolean;
  readonly argv: readonly string[];
  readonly note?: string;
}

function seatbeltProfile(options: SandboxOptions): string {
  const writable = [options.workdir, ...(options.writablePaths ?? [])]
    .map((p) => `(subpath ${JSON.stringify(p)})`)
    .join(' ');
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow sysctl-read)',
    '(allow file-read*)',
    `(allow file-write* ${writable})`,
  ];
  if (options.allowNetwork === true) {
    lines.push('(allow network*)');
  }
  return lines.join(' ');
}

/**
 * Windows process-containment research, issue #35.
 *
 * `buildSandboxCommand` below still returns `ok: false` for `win32` --
 * unchanged from before this patch. What follows is real, working, and
 * verified on a real Windows 11 machine, but is NOT wired into the
 * sandbox-command path yet, and the reasoning for that gap is the actual
 * point of this patch: shipping a mechanism whose headline property doesn't
 * hold up under test would be worse than shipping nothing, on a project
 * whose whole premise is "verify, don't assert."
 *
 * **What's verified working**, via `CreateJobObject` / `AssignProcessToJobObject`
 * / `QueryInformationJobObject` (Win32 APIs, called through PowerShell's
 * `Add-Type -TypeDefinition` inline-C# feature -- no native addon, no new
 * dependency, no elevation required; confirmed directly, repeatedly, on a
 * real machine, as a standard non-admin user):
 *   - Creating a Job Object and assigning a spawned process to it: succeeds.
 *   - Querying the job for its exact live member PID list afterward: succeeds,
 *     and correctly returns the real spawned PID. This is a genuinely more
 *     reliable process-tree signal than `exec.ts`'s existing `taskkill /T`,
 *     which walks parent-PID links at kill time and can miss a descendant
 *     that has re-parented.
 *
 * **What's verified NOT working, tested directly rather than assumed:**
 *   - `netsh advfirewall firewall add rule` (the obvious mechanism for the
 *     "network egress" half of this issue) fails outright for a standard
 *     user: "The requested operation requires elevation (Run as
 *     administrator)." A harness that silently needs Administrator, or
 *     silently no-ops the restriction, would be worse than admitting this
 *     half of the issue isn't closed. Not attempted further here.
 *   - `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` -- the flag most Job Object
 *     write-ups lead with, "closing the handle kills everything in the
 *     job" -- was tried and tested directly: `SetInformationJobObject`
 *     reports success, but the tracked process was **still alive** after
 *     the job handle was closed, repeatably, on this machine. Do not trust
 *     this flag without re-verifying on the target OS build; it did not
 *     hold up here.
 *   - **Relaying the sandboxed command's own stdout/stderr back through a
 *     PowerShell-hosted `System.Diagnostics.Process` wrapper.** This is the
 *     actual blocker on wiring the working pieces above into
 *     `buildSandboxCommand`. Two approaches were tried and both failed
 *     under direct testing: (1) `Register-ObjectEvent` + `BeginOutputReadLine`
 *     (the standard async-event pattern) produced no output at all -- a
 *     synchronous `Process.WaitForExit()` call blocks the same runspace
 *     PowerShell needs to pump queued events on, so the event actions never
 *     fired before the script exited. (2) A synchronous `ReadToEndAsync()`
 *     read, started before `WaitForExit()` specifically to avoid that
 *     ordering problem, instead produced an outright hang for a `node -e`
 *     child process in one test. Plain console-handle inheritance (no
 *     redirection at all) worked correctly for a trivial command (`whoami`)
 *     but silently produced no output at all for `node -e '...'` in the
 *     same test harness -- while exiting cleanly (code 0), meaning `node`
 *     itself ran and exited successfully; the output simply never appeared
 *     wherever the parent was capturing it. `runVerify`
 *     (`orchestrate/verify.ts`) depends on capturing real stdout to check a
 *     task's `expect` pattern -- silently dropping it some but not all of
 *     the time would make verification quietly *less* trustworthy exactly
 *     where this project's honesty bar matters most. Shipping that
 *     regression risk to close a checkbox was judged worse than leaving
 *     `win32` at its current, honest `ok: false`.
 *
 * A future patch that wires this in should solve the output-relay problem
 * first (a small compiled helper, or a carefully audited synchronous
 * stream-copy loop with actual byte-level verification against binary
 * output, not just a short text string) before changing
 * `buildSandboxCommand`'s return value for `win32`.
 */
const JOB_OBJECT_PROBE_PS1 = String.raw`Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class IhJobProbe {
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr h, IntPtr p);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool QueryInformationJobObject(IntPtr h, int c, IntPtr i, uint l, out uint r);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
}
"@
$job = [IhJobProbe]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { Write-Output "CREATE_FAILED"; exit 1 }
Write-Output "CREATE_OK"
[IhJobProbe]::CloseHandle($job) | Out-Null
`;

/**
 * Whether this process can use `IhJobProbe`-style Job Object calls right now
 * (win32 only; not admin-gated, unlike `netsh` -- see module doc above).
 * Spawns `powershell.exe` for real rather than assuming availability from
 * the platform string alone, matching this file's existing
 * `sandboxToolAvailable` convention for Linux's `bwrap`.
 */
export function windowsJobObjectSupported(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', JOB_OBJECT_PROBE_PS1],
    {
      encoding: 'utf8',
    },
  );
  return result.status === 0 && result.stdout.includes('CREATE_OK');
}

/** Build a platform-appropriate sandbox wrapper around `command`. */
export function buildSandboxCommand(
  command: readonly string[],
  platform: Platform,
  options: SandboxOptions,
): SandboxCommand {
  if (command.length === 0) {
    return { ok: false, argv: [], note: 'empty command' };
  }
  if (platform === 'darwin') {
    return { ok: true, argv: ['sandbox-exec', '-p', seatbeltProfile(options), ...command] };
  }
  if (platform === 'linux') {
    const argv = [
      'bwrap',
      '--ro-bind',
      '/',
      '/',
      '--bind',
      options.workdir,
      options.workdir,
      '--dev',
      '/dev',
      '--proc',
      '/proc',
    ];
    for (const p of options.writablePaths ?? []) {
      argv.push('--bind', p, p);
    }
    if (options.allowNetwork !== true) {
      argv.push('--unshare-net');
    }
    argv.push('--', ...command);
    return { ok: true, argv };
  }
  if (platform === 'win32') {
    // Unchanged from before this patch: no filesystem/network restriction is
    // enforced on Windows yet. See this file's module doc (issue #35) for
    // what was investigated, what's verified working (Job Object process
    // tracking, via windowsJobObjectSupported above), and specifically why
    // it isn't wired in here yet (an unresolved output-relay problem that
    // would risk silently breaking runVerify's stdout capture).
    return {
      ok: false,
      argv: [...command],
      note:
        'no OS sandbox available on this platform; refuse to run unsandboxed ' +
        '(see windowsJobObjectSupported() and this file’s module doc, issue #35, ' +
        'for verified-working primitives not yet wired in)',
    };
  }
  return { ok: false, argv: [...command], note: 'no OS sandbox available on this platform; refuse to run unsandboxed' };
}

/**
 * Whether `bin` actually resolves on PATH right now. `buildSandboxCommand`
 * above is a pure builder: it assumes the sandbox tool for a given platform
 * exists, which holds for macOS's built-in `sandbox-exec` but is NOT
 * guaranteed for Linux's `bwrap` — a separate package, absent by default on
 * plenty of real Linux boxes (e.g. GitHub Actions' `ubuntu-latest` runners
 * ship without it). Spawning a command through a missing wrapper fails with
 * an immediate `ENOENT`, which upstream callers must not mistake for the
 * wrapped command itself having run and produced exit code `null`. Callers
 * that actually spawn the built command should check this first and fall
 * back to unsandboxed execution when it's false — see `orchestrate/verify.ts`.
 */
export function sandboxToolAvailable(bin: string): boolean {
  const result = spawnSync('/bin/sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
  return result.status === 0;
}

const SECRET_ENV_KEY = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|SESSION|API)/i;

/** Remove secret-looking environment variables from a child process env. */
export function scrubEnv(
  env: Readonly<Record<string, string | undefined>>,
  allowlist: readonly string[] = [],
): Record<string, string> {
  const allow = new Set(allowlist);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (allow.has(key) || !SECRET_ENV_KEY.test(key)) {
      out[key] = value;
    }
  }
  return out;
}
