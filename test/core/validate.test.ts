import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { validateProject } from '../../src/core/cli/validate.js';
import {
  validateMarketplaceManifest,
  validatePluginManifest,
  validateSkillFrontmatter,
} from '../../src/core/schema/validate.js';

test('skill frontmatter requires kebab-case name and a description', () => {
  assert.equal(validateSkillFrontmatter({ name: 'good-name', description: 'x' }).ok, true);
  assert.equal(validateSkillFrontmatter({ name: 'BadName', description: 'x' }).ok, false);
  assert.equal(validateSkillFrontmatter({ name: 'ok' }).ok, false);
});

test('plugin manifest rejects bad version and non-kebab name', () => {
  assert.equal(validatePluginManifest({ name: 'ideal-harness-core', version: '0.1.0' }).ok, true);
  assert.equal(validatePluginManifest({ name: 'ideal-harness-core', version: 'v1' }).ok, false);
  assert.equal(validatePluginManifest({ name: 'The Ideal Harness_Core' }).ok, false);
});

test('marketplace manifest flags duplicate plugin names and missing source', () => {
  const dup = validateMarketplaceManifest({
    name: 'ideal-harness',
    plugins: [
      { name: 'a', source: './a' },
      { name: 'a', source: './a2' },
    ],
  });
  assert.equal(dup.ok, false);
  assert.ok(dup.issues.some((i) => /duplicate/.test(i.message)));

  const missingSource = validateMarketplaceManifest({ name: 'm', plugins: [{ name: 'a' }] });
  assert.equal(missingSource.ok, false);
});

test('marketplace manifest must have a plugins array', () => {
  assert.equal(validateMarketplaceManifest({ name: 'm' }).ok, false);
});

test('validateProject reports a correct relative path even when root has a trailing separator', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ih-validate-'));
  try {
    await mkdir(join(dir, 'packages'), { recursive: true });
    // A SKILL.md with no leading frontmatter fence → a parse error tagged with its path.
    await writeFile(join(dir, 'packages', 'SKILL.md'), '# no frontmatter\n');

    const report = await validateProject(`${dir}${sep}`); // note the trailing separator
    assert.equal(report.ok, false);
    const issue = report.issues.find((i) => /frontmatter/.test(i.message));
    assert.ok(issue, 'expected a frontmatter error for the malformed SKILL.md');
    // Must be "packages/SKILL.md", not a mangled "ackages/SKILL.md".
    assert.equal((issue?.path ?? '').replaceAll('\\', '/'), 'packages/SKILL.md');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('marketplace accepts object sources (npm/github) and rejects malformed ones', () => {
  const ok = validateMarketplaceManifest({
    name: 'm',
    plugins: [
      { name: 'a', source: { source: 'npm', package: '@scope/a' } },
      { name: 'b', source: { source: 'github', repo: 'owner/b' } },
      { name: 'c', source: './c' },
    ],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));

  // npm source missing its required `package`
  const badNpm = validateMarketplaceManifest({
    name: 'm',
    plugins: [{ name: 'a', source: { source: 'npm' } }],
  });
  assert.equal(badNpm.ok, false);
  assert.ok(badNpm.issues.some((i) => /package/.test(i.message)));

  // unknown source kind
  const badKind = validateMarketplaceManifest({
    name: 'm',
    plugins: [{ name: 'a', source: { source: 'ftp', url: 'x' } }],
  });
  assert.equal(badKind.ok, false);
  assert.ok(badKind.issues.some((i) => /unknown source kind/.test(i.message)));
});
