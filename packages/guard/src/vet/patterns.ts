/**
 * Skill-vetting signature database — a clean-room subset of the SkillSpector
 * taxonomy, grouped by threat category. Scanned against any third-party skill
 * (SKILL.md + bundled scripts) BEFORE it is loaded. Deterministic regex tier;
 * deeper AST/taint/OSV analysis is delegated to external tools (semgrep/OSV),
 * not reimplemented here.
 */

export type ThreatCategory =
  | 'prompt-injection'
  | 'data-exfiltration'
  | 'privilege-escalation'
  | 'supply-chain'
  | 'obfuscation';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface ThreatPattern {
  readonly id: string;
  readonly category: ThreatCategory;
  readonly severity: Severity;
  readonly pattern: RegExp;
  readonly remediation: string;
}

export const THREAT_PATTERNS: readonly ThreatPattern[] = [
  // --- prompt injection ---
  {
    id: 'pi-ignore-instructions',
    category: 'prompt-injection',
    severity: 'high',
    pattern: /ignore (?:all |the )?(?:previous|prior|above) instructions/i,
    remediation: 'Skill text instructs the agent to disregard its own instructions.',
  },
  {
    id: 'pi-exfil-on-trigger',
    category: 'prompt-injection',
    severity: 'critical',
    pattern: /(?:send|post|upload|exfiltrate).{0,40}(?:api[ _-]?key|secret|token|credential|\.env)/i,
    remediation: 'Skill text directs the agent to send secrets somewhere.',
  },
  // --- data exfiltration (in bundled scripts) ---
  {
    id: 'exfil-curl-pipe',
    category: 'data-exfiltration',
    severity: 'high',
    pattern: /\bcurl\b[^\n|]*\|\s*(?:bash|sh|python|node)\b/i,
    remediation: 'Pipes remote content directly into a shell/interpreter.',
  },
  {
    id: 'exfil-post-env',
    category: 'data-exfiltration',
    severity: 'critical',
    pattern: /(?:requests\.post|fetch|axios)\([^)]*(?:os\.environ|process\.env|getenv)/i,
    remediation: 'Posts environment variables to a remote endpoint.',
  },
  {
    id: 'exfil-dns-tunnel',
    category: 'data-exfiltration',
    severity: 'high',
    pattern: /\$\([^)]*\)\.[A-Za-z0-9.-]+\b|nslookup\s+\$/i,
    remediation: 'Possible DNS-tunnel exfiltration via command substitution in a hostname.',
  },
  // --- privilege escalation ---
  {
    id: 'privesc-sudo',
    category: 'privilege-escalation',
    severity: 'high',
    pattern: /\bsudo\s+(?:-S\s+)?(?:rm|chmod|chown|tee|sh|bash|curl)/i,
    remediation: 'Escalates privileges to run a sensitive command.',
  },
  {
    id: 'privesc-docker-sock',
    category: 'privilege-escalation',
    severity: 'critical',
    pattern: /\/var\/run\/docker\.sock/,
    remediation: 'Touches the Docker socket — equivalent to host root.',
  },
  {
    id: 'privesc-ssh-keys',
    category: 'privilege-escalation',
    severity: 'high',
    pattern: /(?:cat|cp|tar|scp)[^\n]*\.ssh\/(?:id_[a-z0-9]+|authorized_keys)/i,
    remediation: 'Reads or copies SSH private keys.',
  },
  // --- supply chain ---
  {
    id: 'supply-pip-extra-index',
    category: 'supply-chain',
    severity: 'medium',
    pattern: /pip\s+install[^\n]*--extra-index-url/i,
    remediation: 'Installs from an alternate package index (dependency-confusion risk).',
  },
  {
    id: 'supply-eval-download',
    category: 'supply-chain',
    severity: 'high',
    pattern: /\beval\s*\(\s*(?:requests\.get|urllib|fetch)/i,
    remediation: 'Evaluates code downloaded at runtime.',
  },
  // --- obfuscation ---
  {
    id: 'obf-base64-exec',
    category: 'obfuscation',
    severity: 'high',
    pattern: /(?:base64\s+(?:-d|--decode)|atob\(|b64decode)[^\n]*\|\s*(?:bash|sh|python|node)/i,
    remediation: 'Decodes and executes obfuscated payload.',
  },
  {
    id: 'obf-hex-escape-blob',
    category: 'obfuscation',
    severity: 'medium',
    pattern: /(?:\\x[0-9a-f]{2}){12,}/i,
    remediation: 'Long hex-escaped blob — likely obfuscated payload.',
  },
];
