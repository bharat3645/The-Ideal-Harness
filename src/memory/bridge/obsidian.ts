/**
 * Obsidian bridge — consented, explicit, human-owned export/import of
 * episodic memory to/from a Markdown vault (VISION §7, v0.4 "consented
 * memory sharing"). An Obsidian vault is just a folder of Markdown files with
 * YAML frontmatter, so reading/writing one needs no Obsidian install, plugin,
 * or app dependency — plain filesystem I/O is the whole bridge.
 *
 * Deliberately NOT automatic: nothing in this module runs on its own, and
 * nothing it reads is merged into the live episodic store for you.
 *   - `exportToVault` only ever writes to a vault folder the caller names
 *     explicitly; it is never invoked by `memory_write` or any hook.
 *   - `importFromVault` only ever returns *candidate* observations for the
 *     human to review; it never calls `store.add` itself.
 * What leaves or enters the project's memory is always something a person
 * chose to run, never a silent background sync — the consent boundary
 * DESIGN.md's addendum called for when it flagged the various community
 * Obsidian MCP servers as "take the idea, not the code."
 *
 * There is deliberately no MCP tool wrapping this module: exporting project
 * memory to an external, human-controlled folder is a data-movement decision,
 * not a routine recall — it stays CLI-only (`ideal-harness-memory vault-*`),
 * the same asymmetry `leases.ts` uses to keep capability grants human-only.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from '../../core/index.js';
import type { Observation, ObservationType } from '../episodic/store.js';

const VALID_TYPES = new Set<ObservationType>(['bugfix', 'feature', 'decision', 'security_alert', 'failure', 'note']);
const DEFAULT_FOLDER = 'ideal-harness';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function noteFilename(obs: Observation): string {
  const slug = slugify(obs.text);
  return `${obs.ts}-${slug.length > 0 ? slug : obs.id}.md`;
}

function renderNote(obs: Observation): string {
  const tags = ['ideal-harness', obs.type, ...(obs.tags ?? [])];
  const lines = [
    '---',
    `id: ${obs.id}`,
    `type: ${obs.type}`,
    `ts: ${obs.ts}`,
    `date: ${new Date(obs.ts).toISOString()}`,
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
    obs.text,
    '',
  ];
  return lines.join('\n');
}

export interface ExportOptions {
  readonly vaultDir: string;
  /** Subfolder within the vault to write notes into. Default 'ideal-harness'. */
  readonly folder?: string;
}

export interface ExportResult {
  readonly written: number;
  readonly unchanged: number;
  readonly files: readonly string[];
}

/** Export observations as Markdown notes into a vault folder. Idempotent: an unchanged note is not rewritten. */
export function exportToVault(observations: readonly Observation[], options: ExportOptions): ExportResult {
  const dir = join(options.vaultDir, options.folder ?? DEFAULT_FOLDER);
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  let written = 0;
  let unchanged = 0;
  for (const obs of observations) {
    const path = join(dir, noteFilename(obs));
    const content = renderNote(obs);
    if (existsSync(path) && readFileSync(path, 'utf8') === content) {
      unchanged += 1;
    } else {
      writeFileSync(path, content, 'utf8');
      written += 1;
    }
    files.push(path);
  }
  return { written, unchanged, files };
}

export interface ImportOptions {
  readonly vaultDir: string;
  readonly folder?: string;
}

export interface ImportCandidate {
  readonly observation: Omit<Observation, 'workspace'>;
  readonly file: string;
}

export interface ImportResult {
  readonly candidates: readonly ImportCandidate[];
  /** Files under the folder that didn't look like a harness-exported note (skipped, not an error). */
  readonly skipped: readonly string[];
}

/**
 * Read notes back as candidate observations. Never writes to the live store —
 * the caller decides what (if anything) to feed into `memory_write`.
 */
export function importFromVault(options: ImportOptions): ImportResult {
  const dir = join(options.vaultDir, options.folder ?? DEFAULT_FOLDER);
  const candidates: ImportCandidate[] = [];
  const skipped: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return { candidates: [], skipped: [] }; // absent folder: nothing to import, not an error
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      skipped.push(path);
      continue;
    }
    const { frontmatter, body } = splitFrontmatter(raw);
    if (frontmatter === null) {
      skipped.push(path);
      continue;
    }
    const fields: Record<string, string> = {};
    for (const line of frontmatter.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
      if (match !== null) {
        fields[match[1] as string] = (match[2] as string).trim();
      }
    }
    const id = fields.id;
    const type = fields.type;
    const ts = Number(fields.ts);
    if (id === undefined || type === undefined || !VALID_TYPES.has(type as ObservationType) || !Number.isFinite(ts)) {
      skipped.push(path); // a human-authored note without our fields — not ours to import
      continue;
    }
    candidates.push({ observation: { id, type: type as ObservationType, ts, text: body.trim() }, file: path });
  }
  return { candidates, skipped };
}
