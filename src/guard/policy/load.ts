/**
 * Operator-owned policy overrides — "let the user change the instructions."
 *
 * The default floor lives in `defaults.ts` and is deliberately not editable
 * through the harness (self-policy protection). This loader gives the *human
 * operator* a sanctioned knob instead: a JSON file, owned by the user and
 * itself covered by the self-policy deny pattern (`ideal-harness\.policy`),
 * so the model cannot rewrite it through the harness — only the human can.
 *
 * Search order (both merged; project entries take precedence by tier order):
 *   1. `<cwd>/ideal-harness.policy.json`         — per-project overrides
 *   2. `~/.config/ideal-harness.policy.json`     — per-user overrides
 *
 * File shape:
 *   {
 *     "disable": ["ask-bash"],                     // default rule ids to drop
 *     "rules": [                                   // user tier, evaluated FIRST
 *       { "id": "u-allow-git-ro", "action": "allow", "tool": "Bash",
 *         "match": "^git (status|log|diff)\\b" }
 *     ]
 *   }
 *
 * Semantics are honest about the softening: user rules form a higher tier
 * (see `evaluateTiered`), so a user allow beats a default ask. Disabling a
 * default DENY rule is permitted — the floor belongs to the operator, not to
 * the harness — but it is warned about loudly so nothing softens silently.
 * A file that fails to parse is ignored with a warning; a malformed rule is
 * skipped with a warning. Loader failure never widens permissions: with no
 * valid user policy the floor is exactly the defaults.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RULES } from './defaults.js';
import type { PolicyAction, PolicyRule } from './types.js';

export const USER_POLICY_FILENAME = 'ideal-harness.policy.json';

/** Kill-switch: set to 'off' to ignore user policy files entirely. */
export const USER_POLICY_ENV_VAR = 'IDEAL_HARNESS_USER_POLICY';

const ACTIONS: ReadonlySet<string> = new Set<PolicyAction>(['allow', 'ask', 'deny']);

export interface UserPolicy {
  /** Valid user rules, in file order (project file first). */
  readonly rules: readonly PolicyRule[];
  /** Default rule ids the user asked to disable. */
  readonly disable: readonly string[];
  /** Human-readable problems found while loading; print them, don't hide them. */
  readonly warnings: readonly string[];
  /** Files that were actually read and parsed. */
  readonly sources: readonly string[];
}

export interface ComposedPolicy {
  /** Tiers for `evaluateTiered`: `[userRules, floorRules]`. */
  readonly tiers: readonly (readonly PolicyRule[])[];
  /** Softening notices (e.g. a default deny rule was disabled). */
  readonly warnings: readonly string[];
}

const EMPTY: UserPolicy = { rules: [], disable: [], warnings: [], sources: [] };

function parseRule(raw: unknown, source: string, index: number, warnings: string[]): PolicyRule | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    warnings.push(`${source}: rules[${index}] is not an object; skipped`);
    return undefined;
  }
  const rule = raw as Record<string, unknown>;
  const id = rule.id;
  if (typeof id !== 'string' || id.trim() === '') {
    warnings.push(`${source}: rules[${index}] has no string id; skipped`);
    return undefined;
  }
  if (id === 'default') {
    warnings.push(`${source}: rule id "default" is reserved (fail-closed sentinel); skipped`);
    return undefined;
  }
  if (typeof rule.action !== 'string' || !ACTIONS.has(rule.action)) {
    warnings.push(`${source}: rule "${id}" has invalid action ${JSON.stringify(rule.action)}; skipped`);
    return undefined;
  }
  if (rule.tool !== undefined && typeof rule.tool !== 'string') {
    warnings.push(`${source}: rule "${id}" has non-string tool; skipped`);
    return undefined;
  }
  if (rule.match !== undefined) {
    if (typeof rule.match !== 'string') {
      warnings.push(`${source}: rule "${id}" has non-string match; skipped`);
      return undefined;
    }
    try {
      new RegExp(rule.match, 'i');
    } catch (error) {
      warnings.push(`${source}: rule "${id}" match does not compile (${(error as Error).message}); skipped`);
      return undefined;
    }
  }
  return {
    id,
    action: rule.action as PolicyAction,
    ...(rule.tool !== undefined ? { tool: rule.tool as string } : {}),
    ...(rule.match !== undefined ? { match: rule.match as string } : {}),
    ...(typeof rule.description === 'string' ? { description: rule.description } : {}),
  };
}

/** Pure parse of one policy document. Exported for direct unit testing. */
export function parseUserPolicy(raw: unknown, source: string): UserPolicy {
  const warnings: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...EMPTY, warnings: [`${source}: policy document is not an object; ignored`] };
  }
  const doc = raw as Record<string, unknown>;
  const rules: PolicyRule[] = [];
  if (doc.rules !== undefined) {
    if (!Array.isArray(doc.rules)) {
      warnings.push(`${source}: "rules" is not an array; ignored`);
    } else {
      doc.rules.forEach((entry, index) => {
        const rule = parseRule(entry, source, index, warnings);
        if (rule !== undefined) {
          rules.push(rule);
        }
      });
    }
  }
  const disable: string[] = [];
  if (doc.disable !== undefined) {
    if (!Array.isArray(doc.disable)) {
      warnings.push(`${source}: "disable" is not an array; ignored`);
    } else {
      for (const entry of doc.disable) {
        if (typeof entry === 'string' && entry.trim() !== '') {
          disable.push(entry);
        } else {
          warnings.push(`${source}: non-string entry in "disable"; skipped`);
        }
      }
    }
  }
  return { rules, disable, warnings, sources: [source] };
}

export interface LoadOptions {
  /** Project directory to look for the policy file in (default `process.cwd()`). */
  cwd?: string;
  /** Home directory for the user-level file (default `os.homedir()`). */
  home?: string;
  /** Environment for the kill-switch (default `process.env`). */
  env?: Record<string, string | undefined>;
  /** Explicit file list, overriding the cwd/home search (for tests). */
  paths?: readonly string[];
}

/** Load and merge user policy files. Missing files are fine; broken ones warn. */
export function loadUserPolicy(options: LoadOptions = {}): UserPolicy {
  const { cwd = process.cwd(), home = homedir(), env = process.env } = options;
  if (env[USER_POLICY_ENV_VAR]?.trim().toLowerCase() === 'off') {
    return { ...EMPTY, warnings: [`user policy disabled via ${USER_POLICY_ENV_VAR}=off`] };
  }
  const paths = options.paths ?? [join(cwd, USER_POLICY_FILENAME), join(home, '.config', USER_POLICY_FILENAME)];

  const rules: PolicyRule[] = [];
  const disable: string[] = [];
  const warnings: string[] = [];
  const sources: string[] = [];

  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue; // absent file: not an event
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (error) {
      warnings.push(`${path}: invalid JSON (${(error as Error).message}); file ignored`);
      continue;
    }
    const parsed = parseUserPolicy(doc, path);
    rules.push(...parsed.rules);
    disable.push(...parsed.disable);
    warnings.push(...parsed.warnings);
    sources.push(path);
  }
  return { rules, disable, warnings, sources };
}

/**
 * Compose the evaluation tiers from a user policy and the default floor:
 * user rules first, then the defaults minus any `disable`d ids. Disabling a
 * default deny rule is allowed but flagged — softening must be loud.
 */
export function composePolicy(user: UserPolicy, defaults: readonly PolicyRule[] = DEFAULT_RULES): ComposedPolicy {
  const warnings: string[] = [];
  const disabled = new Set(user.disable);
  for (const id of disabled) {
    const target = defaults.find((rule) => rule.id === id);
    if (target === undefined) {
      warnings.push(`disable: "${id}" matches no default rule (typo?)`);
    } else if (target.action === 'deny') {
      warnings.push(`⚠ default DENY rule "${id}" disabled by user policy — floor softened`);
    }
  }
  const floor = defaults.filter((rule) => !disabled.has(rule.id));
  const tiers: (readonly PolicyRule[])[] = user.rules.length > 0 ? [user.rules, floor] : [floor];
  return { tiers, warnings };
}
