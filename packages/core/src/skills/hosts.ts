/**
 * Multi-host skill generation.
 *
 * One `SKILL.md.tmpl` (frontmatter + body with `{{VARS}}`) is rendered into a
 * host-specific `SKILL.md` per target. v0.1 keeps the frontmatter contract
 * uniform (name + description) and stamps the target host into a single-line
 * JSON `metadata` field (the cross-host convention), so the same skill text is
 * consumed by Claude Code, Codex, Gemini, and Cursor. Per-host divergence can
 * grow here without touching the parser or the templater.
 */

import type { ParsedSkill } from './frontmatter.js';
import { renderTemplate, type TemplateVars } from './template.js';

export const HOSTS = ['claude', 'codex', 'gemini', 'cursor'] as const;
export type Host = (typeof HOSTS)[number];

export function isHost(value: string): value is Host {
  return (HOSTS as readonly string[]).includes(value);
}

function serializeScalar(value: unknown): string {
  if (typeof value === 'string') {
    // Quote only when the value could be misparsed (leading/trailing space,
    // reserved tokens, or characters that start a different YAML type).
    if (value.length === 0 || /^[[{'"]|[:#]|^\s|\s$|^(?:true|false|null)$/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeScalar(item)).join(', ')}]`;
  }
  return JSON.stringify(value);
}

/** Serialize a flat frontmatter object back into the YAML subset. */
export function serializeFrontmatter(data: Readonly<Record<string, unknown>>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key}: ${serializeScalar(value)}`)
    .join('\n');
}

/** Render a parsed skill template into a host-specific `SKILL.md` string. */
export function renderSkillForHost(parsed: ParsedSkill, host: Host, vars: TemplateVars = {}): string {
  // 1. Body: substitute template vars (host is always available as a var).
  const { text: body } = renderTemplate(parsed.body, { HOST: host, ...vars });

  // 2. Frontmatter: keep name/description first; fold the host into metadata.
  const existingMeta =
    typeof parsed.data.metadata === 'object' && parsed.data.metadata !== null
      ? (parsed.data.metadata as Record<string, unknown>)
      : {};
  const ordered: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) {
    ordered.name = parsed.data.name;
  }
  if (parsed.data.description !== undefined) {
    ordered.description = parsed.data.description;
  }
  for (const [key, value] of Object.entries(parsed.data)) {
    if (key !== 'name' && key !== 'description' && key !== 'metadata') {
      ordered[key] = value;
    }
  }
  ordered.metadata = { ...existingMeta, host };

  // 3. Reassemble.
  return `---\n${serializeFrontmatter(ordered)}\n---\n\n${body}`;
}
