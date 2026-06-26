/**
 * "Dangerously skip permissions" — the human's opt-out of the floor.
 *
 * The guard floor sits below the model and the model cannot disable it by
 * reasoning. The *human operator*, however, may explicitly waive it — exactly
 * mirroring Claude Code's own `--dangerously-skip-permissions`. Two signals,
 * neither of which requires editing `settings.json` (or any file), turn the
 * PreToolUse permission gate off:
 *
 *   1. `permission_mode: "bypassPermissions"` in the hook event — set when the
 *      session is launched with `claude --dangerously-skip-permissions`. This is
 *      the zero-config path: the user already told Claude Code to skip
 *      permissions, so the harness honors the same intent instead of re-blocking.
 *   2. The `IDEAL_HARNESS_DANGEROUSLY_SKIP_PERMISSIONS` env var set to a truthy
 *      value — a file-free escape hatch for hosts that don't surface the mode,
 *      or to bypass the floor without bypassing Claude Code's own prompts.
 *
 * Scope is deliberately narrow: this only relaxes the **permission decision**
 * (deny/ask → allow). PostToolUse output scrubbing (secret redaction, untrusted
 * fencing) is NOT a permission and stays on. The caller is expected to be loud
 * about it — the hook warns on stderr whenever the bypass fires.
 */

export const BYPASS_ENV_VAR = 'IDEAL_HARNESS_DANGEROUSLY_SKIP_PERMISSIONS';

/** Claude Code's `permission_mode` value for `--dangerously-skip-permissions`. */
export const BYPASS_PERMISSION_MODE = 'bypassPermissions';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export interface BypassSignals {
  /** `permission_mode` from the PreToolUse hook event payload, if the host supplies it. */
  permissionMode?: string | undefined;
  /** Process environment to read the opt-out var from (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

/**
 * True when the human has opted out of the permission floor for this session.
 * Pure and deterministic: depends only on its inputs, so it is unit-testable
 * without a live Claude Code host.
 */
export function skipPermissionsActive(signals: BypassSignals = {}): boolean {
  const { permissionMode, env = process.env } = signals;
  if (permissionMode === BYPASS_PERMISSION_MODE) {
    return true;
  }
  const raw = env[BYPASS_ENV_VAR];
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase());
}
