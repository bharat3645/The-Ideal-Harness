/**
 * Default rule set encoding the Anthropic permission checklist.
 *
 * Read-only tools are allowed; credential reads, self-policy writes, and
 * network/push commands are denied or forced to ask. Everything not covered
 * falls through to the engine's fail-closed default (ask). Deny rules use
 * `\b`-free, anchored-ish patterns intended to be hard to bypass.
 */

import type { PolicyRule } from './types.js';

export const DEFAULT_RULES: readonly PolicyRule[] = [
  // === DENY (absolute) ===
  {
    id: 'deny-read-credentials',
    action: 'deny',
    tool: 'Read',
    match: '(?:^|/)\\.(?:aws|ssh|gnupg)/|(?:^|/)\\.env(?:\\.|$)|/\\.netrc$|(?:^|/)id_rsa(?:$|\\.)|(?:^|/)credentials$',
    description: 'reading credential files is denied',
  },
  {
    id: 'deny-self-policy-write',
    action: 'deny',
    tool: 'Edit',
    match: '\\.claude-plugin/|settings\\.json$|managed-settings|ideal-harness\\.policy|src/guard/policy/',
    description: 'rewriting the harness policy/settings is denied (self-policy protection)',
  },
  {
    id: 'deny-self-policy-write-w',
    action: 'deny',
    tool: 'Write',
    match: '\\.claude-plugin/|settings\\.json$|managed-settings|ideal-harness\\.policy|src/guard/policy/',
    description: 'rewriting the harness policy/settings is denied (self-policy protection)',
  },
  {
    id: 'deny-destructive-bash',
    action: 'deny',
    tool: 'Bash',
    match: 'rm\\s+-rf\\s+[~/]|\\bmkfs\\b|dd\\s+if=.*of=/dev/|:\\(\\)\\s*\\{\\s*:\\|',
    description: 'destructive shell command denied',
  },

  // === ASK (manual approval, not auto-allowed) ===
  {
    id: 'ask-network-fetch',
    action: 'ask',
    tool: 'Bash',
    match: '\\b(?:curl|wget|nc|ncat|telnet)\\b',
    description: 'network fetch from shell requires approval',
  },
  {
    id: 'ask-git-push',
    action: 'ask',
    tool: 'Bash',
    match: '\\bgit\\s+push\\b',
    description: 'git push requires approval',
  },
  { id: 'ask-webfetch', action: 'ask', tool: 'WebFetch', description: 'outbound web fetch requires approval' },
  { id: 'ask-bash', action: 'ask', tool: 'Bash', description: 'shell commands require approval by default' },
  { id: 'ask-edit', action: 'ask', tool: 'Edit', description: 'file mutation requires approval by default' },
  { id: 'ask-write', action: 'ask', tool: 'Write', description: 'file creation requires approval by default' },

  // === ALLOW (read-only) ===
  {
    id: 'allow-git-readonly',
    action: 'allow',
    tool: 'Bash',
    // Anchored to plain read-only git forms. The character class rejects
    // chaining/redirection/substitution (; & | < > ` $ newline) anywhere in the
    // args, and the lookahead rejects credential-path args and --output (the
    // one flag that makes these commands write files).
    match: '^git (status|log|diff)(?!.*(?:\\.env|id_rsa|credentials|--output))(\\s[^;&|<>`$\\n]*)?$',
    description: 'read-only git commands are allowed (no chaining, redirection, or credential-path args)',
  },
  { id: 'allow-read', action: 'allow', tool: 'Read', description: 'reading files is allowed' },
  { id: 'allow-glob', action: 'allow', tool: 'Glob', description: 'globbing is allowed' },
  { id: 'allow-grep', action: 'allow', tool: 'Grep', description: 'searching is allowed' },
  { id: 'allow-ls', action: 'allow', tool: 'LS', description: 'listing is allowed' },
];
