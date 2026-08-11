/**
 * Resolve the full operator-configured policy tier stack — capability
 * leases, personal user policy, shared team policy, then the default floor —
 * exactly as `hooks/pretooluse.mjs` composes it for an interactive tool call.
 *
 * Any code path that performs its own gated I/O OUTSIDE the interactive
 * PreToolUse hook (no human is sitting at a prompt to answer an `ask`) must
 * use this instead of hardcoding `[DEFAULT_RULES]`. `ledger_verify`'s Bash
 * spawn and `web_fetch`/`web_docs`' fetch calls are exactly this shape: the
 * default floor asks for both `Bash` and `WebFetch`, and an `ask` here can
 * only ever refuse (there is no one to ask) — so without this, those tools
 * would be permanently unusable no matter how an operator configures policy,
 * because their own `ideal-harness.policy.json` allow rule, team policy, or
 * granted lease would simply never be consulted. That defeats the entire
 * point of the operator-owned policy tiers for anyone trying to run this
 * unattended (a pipeline, a CI job, an embedding product).
 */

import { activeLeaseRules, consumeLease, loadLeases } from './leases.js';
import { DEFAULT_RULES } from './policy/defaults.js';
import { composePolicyTiers, loadTeamPolicy, loadUserPolicy } from './policy/load.js';
import type { PolicyDecision, PolicyRule } from './policy/types.js';

export interface ResolvedTiers {
  readonly tiers: readonly (readonly PolicyRule[])[];
  readonly warnings: readonly string[];
}

export interface ResolveOperatorTiersOptions {
  /** Project root to read `ideal-harness.policy.json` / `.ideal-harness/{team-policy,leases}.json` from. */
  readonly cwd?: string;
  readonly now?: number;
}

/** Compose leases + user policy + team policy + defaults into `evaluateTiered`'s tier list, most specific first. */
export function resolveOperatorTiers(options: ResolveOperatorTiersOptions = {}): ResolvedTiers {
  const warnings: string[] = [];
  let tiers: readonly (readonly PolicyRule[])[] = [DEFAULT_RULES];
  try {
    const cwdOpt = options.cwd !== undefined ? { cwd: options.cwd } : {};
    const user = loadUserPolicy(cwdOpt);
    const team = loadTeamPolicy(cwdOpt);
    const composed = composePolicyTiers([
      { policy: user, label: 'user policy' },
      { policy: team, label: 'team policy' },
    ]);
    warnings.push(...user.warnings, ...team.warnings, ...composed.warnings);
    tiers = composed.tiers;
  } catch (error) {
    warnings.push(
      `policy load failed (${error instanceof Error ? error.message : String(error)}); using default floor`,
    );
  }
  const leaseRules = activeLeaseRules(loadLeases(options.cwd), options.now ?? Date.now());
  if (leaseRules.length > 0) {
    tiers = [leaseRules, ...tiers];
  }
  return { tiers, warnings };
}

/** If `decision` was actually decided by a lease's synthetic rule, record that the lease was used. Mirrors `pretooluse.mjs`. */
export function consumeLeaseIfDecided(decision: PolicyDecision, cwd?: string): void {
  if (decision.ruleId.startsWith('lease:')) {
    consumeLease(decision.ruleId.slice('lease:'.length), cwd);
  }
}
