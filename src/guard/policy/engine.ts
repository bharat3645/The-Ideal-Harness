/**
 * Policy engine — the core of the enforcement floor.
 *
 * Evaluation is deterministic and fail-closed:
 *   1. deny ALWAYS wins: any matching deny rule => deny.
 *   2. else any matching allow rule => allow (an explicit allow beats a
 *      catch-all ask — this is Claude Code's own precedence, and what lets a
 *      narrow `allow-git-readonly` coexist with the broad `ask-bash`).
 *   3. else any matching ask rule => ask.
 *   4. else (nothing matched) => ask. Unmatched requests are never auto-allowed.
 *
 * Precedence is deny > allow > ask > default-ask. A deny is absolute, an allow
 * must be explicit and matched, and the floor for the unknown is manual
 * approval, not silent permission.
 */

import type { PolicyAction, PolicyDecision, PolicyRule, ToolRequest } from './types.js';

/** Extract the string a rule's `match` regex is tested against, per tool kind. */
export function subjectFor(request: ToolRequest): string {
  const input = request.input ?? {};
  switch (request.tool) {
    case 'Bash':
      return typeof input.command === 'string' ? input.command : '';
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return typeof input.file_path === 'string' ? input.file_path : ((input.path as string) ?? '');
    case 'WebFetch':
    case 'WebSearch':
      return (input.url as string) ?? (input.query as string) ?? '';
    default:
      return JSON.stringify(input);
  }
}

/**
 * Normalize a subject before matching so the floor cannot be bypassed by path
 * shape or case. Windows backslash paths (`C:\proj\.env`) are folded to forward
 * slashes so the `/`-anchored credential/self-policy patterns still fire, and a
 * lowercased copy is matched case-insensitively (`.ENV`, `ID_RSA`, `CREDENTIALS`
 * on a case-insensitive filesystem must not slip through).
 */
function normalizeSubject(subject: string): string {
  return subject.replace(/\\/g, '/');
}

function ruleMatches(rule: PolicyRule, request: ToolRequest, subject: string): boolean {
  if (rule.tool !== undefined && rule.tool !== '*' && rule.tool !== request.tool) {
    return false;
  }
  if (rule.match === undefined) {
    return true;
  }
  return new RegExp(rule.match, 'i').test(normalizeSubject(subject));
}

/** Evaluate a tool request against an ordered rule set. */
export function evaluate(request: ToolRequest, rules: readonly PolicyRule[]): PolicyDecision {
  const subject = subjectFor(request);
  const matched = rules.filter((rule) => ruleMatches(rule, request, subject));

  const pick = (action: PolicyAction): PolicyRule | undefined => matched.find((rule) => rule.action === action);

  const deny = pick('deny');
  if (deny !== undefined) {
    return { action: 'deny', ruleId: deny.id, reason: deny.description ?? `denied by ${deny.id}` };
  }
  const allow = pick('allow');
  if (allow !== undefined) {
    return { action: 'allow', ruleId: allow.id, reason: allow.description ?? `allowed by ${allow.id}` };
  }
  const ask = pick('ask');
  if (ask !== undefined) {
    return { action: 'ask', ruleId: ask.id, reason: ask.description ?? `requires approval (${ask.id})` };
  }
  return {
    action: 'ask',
    ruleId: 'default',
    reason: 'no rule matched; fail-closed to manual approval',
  };
}

/**
 * Evaluate against ordered tiers of rules: the first tier in which ANY rule
 * matches decides (with the usual deny > ask > allow precedence inside that
 * tier). Later tiers are only consulted when earlier ones are silent.
 *
 * This is how operator-owned policy overrides layer on top of the default
 * floor: `[userRules, DEFAULT_RULES]` lets a user allow-rule beat a default
 * ask-rule without touching the engine's deny-wins semantics inside a tier.
 * Nothing matched in any tier still fails closed to ask.
 */
export function evaluateTiered(request: ToolRequest, tiers: readonly (readonly PolicyRule[])[]): PolicyDecision {
  for (const tier of tiers) {
    const decision = evaluate(request, tier);
    if (decision.ruleId !== 'default') {
      return decision;
    }
  }
  return {
    action: 'ask',
    ruleId: 'default',
    reason: 'no rule matched in any tier; fail-closed to manual approval',
  };
}
