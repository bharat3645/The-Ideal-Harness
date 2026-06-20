import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateMarketplaceManifest,
  validatePluginManifest,
  validateSkillFrontmatter,
} from '../src/schema/validate.js';

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
