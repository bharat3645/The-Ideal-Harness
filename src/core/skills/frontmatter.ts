/**
 * Dependency-free parser for `SKILL.md` frontmatter.
 *
 * Skill frontmatter is a flat YAML subset: `key: value`, quoted strings,
 * inline `[a, b]` arrays, booleans, numbers, and single-line JSON objects
 * (the multi-host `metadata` convention). We parse exactly that subset
 * deterministically rather than pull in a full YAML dependency — the input
 * is trusted skill files we author, and determinism matters for a harness.
 */

import { err, ok, type Result } from '../result.js';

const FENCE = '---';

export interface ParsedSkill {
  readonly data: Record<string, unknown>;
  readonly body: string;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value.length === 0) {
    return '';
  }
  // Inline JSON object/array (single line) — the multi-host metadata convention.
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch {
      // Fall through to bracket-list / string handling below.
    }
  }
  // Inline `[a, b, c]` list of bare/quoted scalars.
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return inner.split(',').map((item) => parseScalar(item));
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null' || value === '~') {
    return null;
  }
  // Double-quoted: parse as JSON so it is symmetric with serializeScalar(), which
  // emits double-quoted strings via JSON.stringify. Stripping the quotes without
  // unescaping would corrupt any value containing an escaped quote on round-trip.
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  // Single-quoted (YAML semantics): literal, with '' as an escaped single quote.
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  // Numbers, but NOT leading-zero forms ("01", "007"): those are zero-padded
  // identifiers/codes whose leading zeros carry meaning, so keep them as strings
  // rather than silently coercing to 1 / 7 and losing information.
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

/**
 * Split a document into its frontmatter block and body.
 * Returns a null frontmatter string when the document has no leading fence.
 */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  // Strip a leading BOM and normalize CRLF / lone-CR to LF so the parser is
  // line-ending agnostic — a CRLF checkout (Windows) must parse identically to LF.
  const normalized = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith(`${FENCE}\n`) && !normalized.startsWith(`${FENCE}\r\n`)) {
    return { frontmatter: null, body: normalized };
  }
  const afterOpen = normalized.slice(normalized.indexOf('\n') + 1);
  const closeIndex = afterOpen.indexOf(`\n${FENCE}`);
  if (closeIndex === -1) {
    return { frontmatter: null, body: normalized };
  }
  const frontmatter = afterOpen.slice(0, closeIndex);
  const rest = afterOpen.slice(closeIndex + FENCE.length + 1);
  return { frontmatter, body: rest.replace(/^\r?\n/, '') };
}

/** Parse a full `SKILL.md` into `{ data, body }`. */
export function parseSkill(content: string): Result<ParsedSkill, Error> {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter === null) {
    return err(new Error('SKILL.md is missing a leading `---` frontmatter block'));
  }
  const data: Record<string, unknown> = {};
  const lines = frontmatter.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    if (/^\s/.test(line)) {
      return err(new Error(`nested/indented frontmatter is unsupported: "${line}"`));
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (match === null) {
      return err(new Error(`malformed frontmatter line: "${line}"`));
    }
    const [, key, rawValue] = match;
    data[key as string] = parseScalar(rawValue ?? '');
  }
  return ok({ data, body });
}
