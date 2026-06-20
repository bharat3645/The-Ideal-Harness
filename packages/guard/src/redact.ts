/**
 * Always-on secret redaction.
 *
 * Runs below the LLM (PreToolUse on inputs, PostToolUse on outputs) so secrets
 * never reach the model, the logs, or a subprocess. This is a safety control:
 * it is NOT gated behind any compression/verbosity toggle — it always runs.
 */

export interface RedactionPattern {
  readonly type: string;
  readonly pattern: RegExp;
}

/** Ordered, specific-first so e.g. an Anthropic key isn't caught by the generic rule. */
export const SECRET_PATTERNS: readonly RedactionPattern[] = [
  {
    type: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END[^\n]*-----/g,
  },
  { type: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  { type: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { type: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { type: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { type: 'google-key', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { type: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { type: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/gi },
];

export interface RedactionResult {
  readonly text: string;
  readonly count: number;
  readonly types: readonly string[];
}

/** Replace detected secrets with `[REDACTED:type]`. Returns counts for auditing. */
export function redactSecrets(input: string): RedactionResult {
  let text = input;
  let count = 0;
  const types = new Set<string>();
  for (const { type, pattern } of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      count += 1;
      types.add(type);
      return `[REDACTED:${type}]`;
    });
  }
  return { text, count, types: [...types] };
}
