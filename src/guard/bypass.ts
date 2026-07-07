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

import type { PolicyDecision } from './policy/types.js';

export const BYPASS_ENV_VAR = 'IDEAL_HARNESS_DANGEROUSLY_SKIP_PERMISSIONS';

/** Claude Code's `permission_mode` value for `--dangerously-skip-permissions`. */
export const BYPASS_PERMISSION_MODE = 'bypassPermissions';

/** Operator-selected strictness of the permission floor. */
export const FLOOR_MODE_ENV_VAR = 'IDEAL_HARNESS_FLOOR_MODE';

/**
 * How hard the floor pushes back:
 *   - `soft`    — DEFAULT. Nothing is hard-blocked: every deny becomes an ask,
 *                 so the human decides instead of the harness. Allows are
 *                 unchanged, and unmatched calls still fail closed to ask.
 *                 This mirrors Claude Code's own out-of-the-box posture
 *                 (no hard denies unless configured; the human approves).
 *   - `enforce` — `IDEAL_HARNESS_FLOOR_MODE=enforce`: deny is deny, ask is ask.
 *                 The strict opt-in for untrusted repos / unattended runs.
 *   - `bypass`  — allow-all (same as dangerously-skip-permissions).
 *
 * An explicitly set but unrecognized mode value resolves to `enforce`, not the
 * soft default: a broken operator signal fails to the strictest mode rather
 * than silently softening.
 */
export type FloorMode = 'enforce' | 'soft' | 'bypass';

export const DEFAULT_FLOOR_MODE: FloorMode = 'soft';

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

/**
 * Resolve the operator's floor mode for this session. Bypass signals (the
 * Claude Code flag or the skip-permissions env var) win; otherwise
 * `IDEAL_HARNESS_FLOOR_MODE` selects the mode. Unset/empty resolves to the
 * soft default; an explicitly set but unrecognized value resolves to
 * `enforce` (a broken operator signal must never soften). Pure, like
 * `skipPermissionsActive`, so it is unit-testable without a live host.
 */
export function floorMode(signals: BypassSignals = {}): FloorMode {
  if (skipPermissionsActive(signals)) {
    return 'bypass';
  }
  const { env = process.env } = signals;
  const raw = env[FLOOR_MODE_ENV_VAR]?.trim().toLowerCase();
  if (raw === undefined || raw === '') {
    return DEFAULT_FLOOR_MODE;
  }
  if (raw === 'bypass' || raw === 'soft' || raw === 'enforce') {
    return raw;
  }
  return 'enforce';
}

/**
 * Apply the operator's floor mode to a policy decision. In `soft` mode a deny
 * is downgraded to ask — the human is consulted instead of hard-blocked; in
 * `bypass` mode everything is allowed. The original reason is preserved in
 * the output so the softening is visible, never silent.
 */
export function applyFloorMode(decision: PolicyDecision, mode: FloorMode): PolicyDecision {
  if (mode === 'bypass' && decision.action !== 'allow') {
    return {
      action: 'allow',
      ruleId: decision.ruleId,
      reason: `floor bypassed by operator (was ${decision.action}: ${decision.reason})`,
    };
  }
  if (mode === 'soft' && decision.action === 'deny') {
    return {
      action: 'ask',
      ruleId: decision.ruleId,
      reason: `soft floor: deny downgraded to ask — ${decision.reason}`,
    };
  }
  return decision;
}
