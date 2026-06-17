/** Policy types for the enforcement floor. */

export type PolicyAction = 'allow' | 'ask' | 'deny';

/** A normalized tool-use request the policy engine evaluates. */
export interface ToolRequest {
  readonly tool: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

export interface PolicyRule {
  readonly id: string;
  readonly action: PolicyAction;
  /** Tool name to match, or '*' / omitted for any tool. */
  readonly tool?: string;
  /** Regex (string form) matched against the request's subject field. Omitted = matches any. */
  readonly match?: string;
  readonly description?: string;
}

export interface PolicyDecision {
  readonly action: PolicyAction;
  /** Id of the rule that decided, or 'default' when nothing matched (fail-closed). */
  readonly ruleId: string;
  readonly reason: string;
}
