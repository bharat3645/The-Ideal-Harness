/**
 * Real ledger verification — "done" as a measurement, not an assertion.
 *
 * `TaskVerify.command` used to be re-run only by an LLM reviewer agent taking
 * its own Bash tool call on faith (`agents/reviewer.md`'s prose instruction).
 * This module actually spawns the command and reports what happened, so a
 * dishonest or mistaken "it passes" claim can be checked deterministically.
 *
 * Two safety properties, because this path bypasses the interactive
 * PreToolUse hook entirely (there is no human sitting at a prompt to answer
 * an `ask` here):
 *
 *   1. **Policy-gated, unsoftened.** The command is evaluated against the
 *      same deny/allow/ask rules a Bash tool call would face (default floor +
 *      any caller-supplied policy tiers), with NO floor-mode softening. Only
 *      an explicit `allow` runs; `ask` or `deny` refuses and reports the
 *      decision instead of executing. This is what stops a compromised or
 *      hallucinating implementer agent from planting a destructive
 *      `verify.command` that a later automated re-run would execute
 *      unattended. There is no bypass flag on the MCP tool — only a human
 *      using the CLI's own Bash tool (already hook-gated) can run something
 *      the policy declines to auto-verify.
 *   2. **Sandboxed when the platform supports it.** `guard/sandbox.ts` had no
 *      caller before this; darwin/linux runs go through it. Windows/other
 *      platforms have no OS sandbox available, so the (already policy-gated)
 *      command runs unsandboxed rather than refusing outright — refusing
 *      would make verification simply not work on a large share of real dev
 *      machines, which defeats the point. This is reported honestly via
 *      `sandboxed: false` and `sandboxNote`, never hidden. The same fallback
 *      applies when the platform's sandbox tool (Linux's `bwrap`) is claimed
 *      supported but isn't actually installed — see `sandboxToolAvailable`.
 */

import {
  buildSandboxCommand,
  DEFAULT_RULES,
  evaluateTiered,
  execCommand,
  type Platform,
  type PolicyDecision,
  type PolicyRule,
  sandboxToolAvailable,
  scrubEnv,
} from '../guard/index.js';
import type { TaskVerify } from './ledger.js';

export interface VerifyRunResult {
  readonly ok: boolean;
  /** False when the policy gate refused to run the command at all. */
  readonly ran: boolean;
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly expectMatched?: boolean;
  readonly sandboxed: boolean;
  readonly sandboxNote?: string;
  readonly timedOut: boolean;
  readonly decision: PolicyDecision;
}

export interface RunVerifyOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly platform?: Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly writablePaths?: readonly string[];
  readonly allowNetwork?: boolean;
  /** Policy tiers to gate the command against, most specific first. Defaults to just the floor. */
  readonly policyTiers?: readonly (readonly PolicyRule[])[];
}

const DEFAULT_TIMEOUT_MS = 120_000;

function detectPlatform(): Platform {
  if (process.platform === 'darwin') {
    return 'darwin';
  }
  if (process.platform === 'linux') {
    return 'linux';
  }
  return 'other';
}

/** Actually run a task's verify command. See module doc for the two safety properties. */
export async function runVerify(verify: TaskVerify, options: RunVerifyOptions = {}): Promise<VerifyRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? detectPlatform();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = scrubEnv(options.env ?? process.env);
  const tiers = options.policyTiers ?? [DEFAULT_RULES];

  const decision = evaluateTiered({ tool: 'Bash', input: { command: verify.command } }, tiers);
  if (decision.action !== 'allow') {
    return {
      ok: false,
      ran: false,
      command: verify.command,
      exitCode: null,
      stdout: '',
      stderr: '',
      sandboxed: false,
      timedOut: false,
      decision,
    };
  }

  const builtSandbox =
    platform === 'other'
      ? { ok: false as const, argv: [] as readonly string[], note: 'no OS sandbox available on this platform' }
      : buildSandboxCommand(['/bin/sh', '-c', verify.command], platform, {
          workdir: cwd,
          ...(options.writablePaths !== undefined ? { writablePaths: options.writablePaths } : {}),
          ...(options.allowNetwork !== undefined ? { allowNetwork: options.allowNetwork } : {}),
        });

  // buildSandboxCommand() assumes the platform's sandbox tool exists; on
  // Linux that's bwrap, a separate package that's frequently NOT installed
  // (e.g. GitHub Actions' ubuntu-latest runners). Spawning through a missing
  // wrapper fails immediately with ENOENT, which used to surface as a
  // fabricated exitCode: null instead of ever running the command. Verify
  // the tool is actually there and fall back to unsandboxed execution
  // (same as the "no OS sandbox on this platform" path above) when it's not.
  const sandbox =
    builtSandbox.ok && !sandboxToolAvailable(builtSandbox.argv[0] as string)
      ? {
          ok: false as const,
          argv: [] as readonly string[],
          note: `${builtSandbox.argv[0]} not found on PATH; running unsandboxed`,
        }
      : builtSandbox;

  const result = sandbox.ok
    ? await execCommand(sandbox.argv, null, { cwd, env, timeoutMs })
    : await execCommand(null, verify.command, { cwd, env, timeoutMs });

  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const expectMatched = verify.expect !== undefined ? combined.includes(verify.expect.toLowerCase()) : undefined;
  const ok = !result.timedOut && result.exitCode === 0 && expectMatched !== false;

  return {
    ok,
    ran: true,
    command: verify.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(expectMatched !== undefined ? { expectMatched } : {}),
    sandboxed: sandbox.ok,
    ...(sandbox.ok ? {} : { sandboxNote: sandbox.note }),
    timedOut: result.timedOut,
    decision,
  };
}
