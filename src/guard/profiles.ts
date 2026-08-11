/**
 * Named profiles — a session-selectable bundle over the floor-mode knob.
 *
 * VISION.md's profiles idea (§4.3) also names an "explain verbosity" axis,
 * but no such knob exists yet in v0.1 — every policy decision's `reason`
 * already carries the rule's description at one fixed verbosity, with no
 * separate quiet/verbose mode to select. So profiles here honestly bundle
 * only what's real today: floor mode. Extend `PROFILES` + `Profile` (not the
 * resolution logic) once a verbosity knob actually ships — a profile must
 * never claim to select a dial that doesn't exist.
 *
 * No new enforcement mechanism: `resolveProfile` is a pure lookup that
 * `floorMode()` (`bypass.ts`) consults as a fallback tier between the
 * explicit `IDEAL_HARNESS_FLOOR_MODE` override and the soft default — so a
 * single-knob override still wins over a profile, and an unset or broken
 * profile name is never silently softer than the existing default.
 */

import type { FloorMode } from './bypass.js';

export type ProfileName = 'strict' | 'default' | 'fast';

export interface Profile {
  readonly name: ProfileName;
  readonly floorMode: FloorMode;
}

export const PROFILE_ENV_VAR = 'IDEAL_HARNESS_PROFILE';

export const PROFILES: Readonly<Record<ProfileName, Profile>> = {
  strict: { name: 'strict', floorMode: 'enforce' },
  default: { name: 'default', floorMode: 'soft' },
  fast: { name: 'fast', floorMode: 'soft' },
};

const PROFILE_NAMES: ReadonlySet<string> = new Set(Object.keys(PROFILES));

/**
 * Resolve the named profile from the environment. Unset/empty resolves to
 * `default`. An explicitly set but unrecognized name resolves to `strict` —
 * the same "a broken operator signal must never soften" rule `floorMode`
 * itself already applies to `IDEAL_HARNESS_FLOOR_MODE`.
 */
export function resolveProfile(env: Record<string, string | undefined> = process.env): Profile {
  const raw = env[PROFILE_ENV_VAR]?.trim().toLowerCase();
  if (raw === undefined || raw === '') {
    return PROFILES.default;
  }
  if (PROFILE_NAMES.has(raw)) {
    return PROFILES[raw as ProfileName];
  }
  return PROFILES.strict;
}
