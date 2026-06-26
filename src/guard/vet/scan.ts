/**
 * Skill scanner — the vetting gate. Runs the signature DB + hidden-char
 * detection over a skill's text and returns findings with a worst-severity
 * verdict. Callers (hook / MCP / CLI) decide whether to block on `ok`.
 */

import { findHiddenChars } from './homoglyph.js';
import { type Severity, THREAT_PATTERNS, type ThreatCategory } from './patterns.js';

export interface ScanFinding {
  readonly id: string;
  readonly category: ThreatCategory | 'hidden-characters';
  readonly severity: Severity;
  readonly evidence: string;
  readonly remediation: string;
}

export interface ScanResult {
  readonly findings: readonly ScanFinding[];
  readonly maxSeverity: Severity | 'none';
  /** Vetting verdict: false if any finding is `high` or `critical`. */
  readonly ok: boolean;
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { low: 1, medium: 2, high: 3, critical: 4 };

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  return text
    .slice(start, index + length + 20)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Scan skill text (SKILL.md or bundled script source) for threats. */
export function scanSkill(content: string): ScanResult {
  const findings: ScanFinding[] = [];

  for (const tp of THREAT_PATTERNS) {
    const match = tp.pattern.exec(content);
    if (match !== null) {
      findings.push({
        id: tp.id,
        category: tp.category,
        severity: tp.severity,
        evidence: snippet(content, match.index, match[0].length),
        remediation: tp.remediation,
      });
    }
  }

  for (const hidden of findHiddenChars(content)) {
    findings.push({
      id: `hidden-${hidden.kind}`,
      category: 'hidden-characters',
      severity: hidden.kind === 'confusable' ? 'medium' : 'high',
      evidence: `U+${hidden.codepoint.toString(16).toUpperCase().padStart(4, '0')} at index ${hidden.index}`,
      remediation: hidden.note,
    });
  }

  let max = 0;
  for (const f of findings) {
    max = Math.max(max, SEVERITY_ORDER[f.severity]);
  }
  const maxSeverity = (Object.keys(SEVERITY_ORDER) as Severity[]).find((s) => SEVERITY_ORDER[s] === max) ?? 'none';

  return { findings, maxSeverity, ok: max < SEVERITY_ORDER.high };
}
