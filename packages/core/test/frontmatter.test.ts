import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSkill, splitFrontmatter } from '../src/skills/frontmatter.js';

test('parses flat frontmatter with mixed scalar types', () => {
  const md = [
    '---',
    'name: my-skill',
    'description: Does a thing',
    'user-invocable: false',
    'allowed-tools: [Read, Write]',
    'metadata: {"host": "claude", "n": 2}',
    '---',
    '',
    '# Body here',
    'line two',
  ].join('\n');
  const parsed = parseSkill(md);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.value.data.name, 'my-skill');
  assert.equal(parsed.value.data['user-invocable'], false);
  assert.deepEqual(parsed.value.data['allowed-tools'], ['Read', 'Write']);
  assert.deepEqual(parsed.value.data.metadata, { host: 'claude', n: 2 });
  assert.match(parsed.value.body, /# Body here/);
});

test('errors when frontmatter fence is missing', () => {
  const parsed = parseSkill('# no frontmatter\n');
  assert.equal(parsed.ok, false);
});

test('errors on nested/indented frontmatter', () => {
  const md = '---\nname: x\nmeta:\n  nested: true\n---\nbody';
  const parsed = parseSkill(md);
  assert.equal(parsed.ok, false);
});

test('splitFrontmatter handles a leading BOM', () => {
  const { frontmatter, body } = splitFrontmatter('﻿---\nname: x\n---\nbody\n');
  assert.equal(frontmatter, 'name: x');
  assert.equal(body.trim(), 'body');
});
