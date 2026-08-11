/**
 * `ideal-harness render-skills <skillsDir> <outDir> [--hosts=a,b]`
 *
 * Batch-applies `gen-hosts.ts`'s single-file renderer across every
 * `SKILL.md` under `skillsDir`, writing `<outDir>/<host>/<skillName>/SKILL.md`
 * for each. Completes the host shim (VISION §7, v0.5): the multi-host
 * template mechanism (`hosts.ts`/`template.ts`) has existed since v0.1 but
 * was only ever exercised one file at a time; this is what actually renders
 * this project's real, shipped skills for Codex/Gemini/Cursor, not just a
 * hand-picked template.
 *
 * Scope, stated honestly: this renders skill TEXT only. The enforcement
 * floor (guard's PreToolUse/PostToolUse hooks) is a Claude-Code-specific
 * JSON hook contract and is NOT rendered or ported by this command — a
 * skill running on another host still has no deterministic floor beneath
 * it there, only whatever that host's own permission model provides.
 */

import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkill } from '../skills/frontmatter.js';
import { HOSTS, type Host, isHost, renderSkillForHost } from '../skills/hosts.js';

export interface RenderSkillsOptions {
  readonly skillsDir: string;
  readonly outDir: string;
  readonly hosts: readonly Host[];
}

export async function renderAllSkills(options: RenderSkillsOptions): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(options.skillsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`could not read skills directory "${options.skillsDir}": ${(error as Error).message}`);
  }
  const written: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = join(options.skillsDir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = await readFile(skillPath, 'utf8');
    } catch {
      continue; // not a skill directory (no SKILL.md) -- not an error, just skipped
    }
    const parsed = parseSkill(content);
    if (!parsed.ok) {
      throw new Error(`${skillPath}: ${parsed.error.message}`);
    }
    for (const host of options.hosts) {
      const rendered = renderSkillForHost(parsed.value, host, {});
      const dir = join(options.outDir, host, entry.name);
      await mkdir(dir, { recursive: true });
      const target = join(dir, 'SKILL.md');
      await writeFile(target, rendered, 'utf8');
      written.push(target);
    }
  }
  return written;
}

export async function runRenderSkills(argv: readonly string[]): Promise<number> {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const hostFlag = argv.find((arg) => arg.startsWith('--hosts='));
  const [skillsDir, outDir] = positional;
  if (skillsDir === undefined || outDir === undefined) {
    process.stderr.write('usage: ideal-harness render-skills <skillsDir> <outDir> [--hosts=claude,codex]\n');
    return 1;
  }
  let hosts: Host[];
  if (hostFlag) {
    const requested = hostFlag
      .slice('--hosts='.length)
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const invalid = requested.filter((value) => !isHost(value));
    if (invalid.length > 0) {
      process.stderr.write(`warning: ignoring unknown host(s): ${invalid.join(', ')}. Valid: ${HOSTS.join(', ')}\n`);
    }
    hosts = requested.filter(isHost);
    if (hosts.length === 0) {
      process.stderr.write('no valid hosts requested; nothing generated\n');
      return 1;
    }
  } else {
    hosts = [...HOSTS];
  }
  let written: string[];
  try {
    written = await renderAllSkills({ skillsDir, outDir, hosts });
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
  for (const path of written) {
    process.stdout.write(`wrote ${path}\n`);
  }
  process.stderr.write(`rendered ${written.length} file(s) across ${hosts.length} host(s)\n`);
  return 0;
}
