/**
 * Deterministic schema validation for plugin/marketplace manifests and skill
 * frontmatter. Pure functions over already-parsed objects so they are testable
 * without touching the filesystem. The CLI layer handles parsing from disk.
 */

import type { IssueSeverity, ValidationIssue, ValidationReport } from './types.js';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_LOOSE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

class IssueCollector {
  private readonly issues: ValidationIssue[] = [];

  add(severity: IssueSeverity, path: string, message: string): void {
    this.issues.push({ severity, path, message });
  }

  error(path: string, message: string): void {
    this.add('error', path, message);
  }

  warn(path: string, message: string): void {
    this.add('warning', path, message);
  }

  report(): ValidationReport {
    return { ok: !this.issues.some((issue) => issue.severity === 'error'), issues: this.issues };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(c: IssueCollector, obj: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    c.error(`${path}.${key}`, `must be a non-empty string`);
    return undefined;
  }
  return value;
}

/** Validate a `SKILL.md` frontmatter object. */
export function validateSkillFrontmatter(input: unknown, path = 'frontmatter'): ValidationReport {
  const c = new IssueCollector();
  if (!isRecord(input)) {
    c.error(path, 'frontmatter must be a key/value mapping');
    return c.report();
  }

  const name = requireString(c, input, 'name', path);
  if (name !== undefined && !KEBAB_CASE.test(name)) {
    c.error(`${path}.name`, `skill name must be kebab-case (got "${name}")`);
  }

  const description = requireString(c, input, 'description', path);
  if (description !== undefined && description.length > 1024) {
    c.warn(`${path}.description`, 'description is very long; descriptions are loaded eagerly, keep them tight');
  }

  if ('allowed-tools' in input && !Array.isArray(input['allowed-tools'])) {
    c.error(`${path}.allowed-tools`, 'must be an array of tool names');
  }
  if ('user-invocable' in input && typeof input['user-invocable'] !== 'boolean') {
    c.error(`${path}.user-invocable`, 'must be a boolean');
  }

  return c.report();
}

/** Validate a `.claude-plugin/plugin.json` object. */
export function validatePluginManifest(input: unknown, path = 'plugin'): ValidationReport {
  const c = new IssueCollector();
  if (!isRecord(input)) {
    c.error(path, 'plugin manifest must be an object');
    return c.report();
  }

  const name = requireString(c, input, 'name', path);
  if (name !== undefined && !KEBAB_CASE.test(name)) {
    c.error(`${path}.name`, `plugin name must be kebab-case (got "${name}")`);
  }

  if ('version' in input) {
    const version = input.version;
    if (typeof version !== 'string' || !SEMVER_LOOSE.test(version)) {
      c.error(`${path}.version`, 'version must be a semver string (x.y.z)');
    }
  } else {
    c.warn(path, 'no version field; recommended for publishable plugins');
  }

  if ('description' in input && typeof input.description !== 'string') {
    c.error(`${path}.description`, 'description must be a string');
  }

  return c.report();
}

/** Validate a `.claude-plugin/marketplace.json` object. */
export function validateMarketplaceManifest(input: unknown, path = 'marketplace'): ValidationReport {
  const c = new IssueCollector();
  if (!isRecord(input)) {
    c.error(path, 'marketplace manifest must be an object');
    return c.report();
  }

  requireString(c, input, 'name', path);

  const plugins = input.plugins;
  if (!Array.isArray(plugins)) {
    c.error(`${path}.plugins`, 'must be an array of plugin entries');
    return c.report();
  }

  const seen = new Set<string>();
  plugins.forEach((entry, index) => {
    const entryPath = `${path}.plugins[${index}]`;
    if (!isRecord(entry)) {
      c.error(entryPath, 'plugin entry must be an object');
      return;
    }
    const name = requireString(c, entry, 'name', entryPath);
    requireString(c, entry, 'source', entryPath);
    if (name !== undefined) {
      if (seen.has(name)) {
        c.error(`${entryPath}.name`, `duplicate plugin name "${name}"`);
      }
      seen.add(name);
    }
  });

  return c.report();
}

/** Merge several reports into one (logical AND of `ok`). */
export function mergeReports(reports: readonly ValidationReport[]): ValidationReport {
  const issues = reports.flatMap((report) => report.issues);
  return { ok: !issues.some((issue) => issue.severity === 'error'), issues };
}
