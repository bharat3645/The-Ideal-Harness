/**
 * `ideal-harness validate` — walk a The Ideal Harness repo and validate every manifest and
 * skill frontmatter, below the LLM. Used in CI as a hard gate.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ValidationIssue, ValidationReport } from '../schema/types.js';
import {
  mergeReports,
  validateMarketplaceManifest,
  validatePluginManifest,
  validateSkillFrontmatter,
} from '../schema/validate.js';
import { parseSkill } from '../skills/frontmatter.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-test', '.git', '.turbo', 'coverage']);

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Recursively collect every `SKILL.md` under a root, skipping build/vendor dirs. */
async function findSkillFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(dir, entry.name));
        }
      } else if (entry.name === 'SKILL.md') {
        out.push(join(dir, entry.name));
      }
    }
  }
  await walk(root);
  return out;
}

function tag(report: ValidationReport, prefix: string): ValidationIssue[] {
  return report.issues.map((issue) => ({ ...issue, path: `${prefix}: ${issue.path}` }));
}

/** Validate the whole project rooted at `root`. */
export async function validateProject(root: string): Promise<ValidationReport> {
  const reports: ValidationReport[] = [];

  // 1. Marketplace manifest + each referenced plugin manifest.
  const marketplacePath = join(root, '.claude-plugin', 'marketplace.json');
  if (await pathExists(marketplacePath)) {
    const marketplace = await readJson(marketplacePath);
    const mReport = validateMarketplaceManifest(marketplace);
    reports.push({ ok: mReport.ok, issues: tag(mReport, 'marketplace.json') });

    const plugins = (marketplace as { plugins?: unknown }).plugins;
    if (Array.isArray(plugins)) {
      for (const entry of plugins) {
        const source = (entry as { source?: unknown }).source;
        if (typeof source !== 'string' || !source.startsWith('.')) {
          continue;
        }
        const pluginManifest = join(root, source, '.claude-plugin', 'plugin.json');
        if (await pathExists(pluginManifest)) {
          const pReport = validatePluginManifest(await readJson(pluginManifest));
          reports.push({ ok: pReport.ok, issues: tag(pReport, `${source}/plugin.json`) });
        } else {
          reports.push({
            ok: false,
            issues: [{ severity: 'error', path: source, message: 'plugin source has no .claude-plugin/plugin.json' }],
          });
        }
      }
    }
  }

  // 2. Every SKILL.md frontmatter.
  for (const skillPath of await findSkillFiles(root)) {
    const content = await readFile(skillPath, 'utf8');
    const parsed = parseSkill(content);
    // Use relative() rather than slicing by root.length: a root passed with a
    // trailing separator (e.g. `validate ./project/`) would otherwise drop a
    // leading character and report a mangled path like "ackages/SKILL.md".
    const rel = relative(root, skillPath);
    if (!parsed.ok) {
      reports.push({ ok: false, issues: [{ severity: 'error', path: rel, message: parsed.error.message }] });
      continue;
    }
    const sReport = validateSkillFrontmatter(parsed.value.data);
    reports.push({ ok: sReport.ok, issues: tag(sReport, rel) });
  }

  return mergeReports(reports);
}

export async function runValidate(root: string): Promise<number> {
  const report = await validateProject(root);
  for (const issue of report.issues) {
    const stream = issue.severity === 'error' ? process.stderr : process.stdout;
    stream.write(`${issue.severity === 'error' ? 'ERROR' : 'warn '} ${issue.path} — ${issue.message}\n`);
  }
  if (report.ok) {
    process.stdout.write(`ideal-harness validate: OK (${report.issues.length} warning(s))\n`);
    return 0;
  }
  process.stderr.write('ideal-harness validate: FAILED\n');
  return 1;
}
