/**
 * `ideal-harness gen-hosts <template> <outDir> [--hosts a,b]` — render one
 * `SKILL.md.tmpl` into per-host `SKILL.md` files.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkill } from '../skills/frontmatter.js';
import { HOSTS, type Host, isHost, renderSkillForHost } from '../skills/hosts.js';

export interface GenHostsOptions {
  readonly templatePath: string;
  readonly outDir: string;
  readonly hosts: readonly Host[];
  readonly vars?: Readonly<Record<string, string>>;
}

export async function generateHostSkills(options: GenHostsOptions): Promise<string[]> {
  const content = await readFile(options.templatePath, 'utf8');
  const parsed = parseSkill(content);
  if (!parsed.ok) {
    throw parsed.error;
  }
  const written: string[] = [];
  for (const host of options.hosts) {
    const rendered = renderSkillForHost(parsed.value, host, options.vars ?? {});
    const dir = join(options.outDir, host);
    await mkdir(dir, { recursive: true });
    const target = join(dir, 'SKILL.md');
    await writeFile(target, rendered, 'utf8');
    written.push(target);
  }
  return written;
}

export async function runGenHosts(argv: readonly string[]): Promise<number> {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const hostFlag = argv.find((arg) => arg.startsWith('--hosts='));
  const [templatePath, outDir] = positional;
  if (templatePath === undefined || outDir === undefined) {
    process.stderr.write('usage: ideal-harness gen-hosts <template> <outDir> [--hosts=claude,codex]\n');
    return 1;
  }
  const hosts: Host[] = hostFlag
    ? hostFlag
        .slice('--hosts='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(isHost)
    : [...HOSTS];
  const written = await generateHostSkills({ templatePath, outDir, hosts });
  for (const path of written) {
    process.stdout.write(`wrote ${path}\n`);
  }
  return 0;
}
