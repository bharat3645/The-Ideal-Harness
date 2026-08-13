/**
 * Sandbox command builder + subprocess env-scrub.
 *
 * Builds an OS-level sandbox wrapper (macOS Seatbelt, Linux bubblewrap) around
 * a command so filesystem/network restrictions bind every child process, not
 * just the model's file tools. On an unsupported platform it fails closed:
 * `ok: false`, and the caller must refuse to run rather than run unsandboxed.
 */

import { spawnSync } from 'node:child_process';

export type Platform = 'darwin' | 'linux' | 'other';

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
