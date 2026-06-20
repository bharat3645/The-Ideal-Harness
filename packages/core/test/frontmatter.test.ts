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

test('parses CRLF frontmatter (Windows checkout) identically to LF', () => {
  // A trailing \r on the last frontmatter key used to break the line regex,
  // failing `validate .` on every Windows checkout.
  const md = ['---', 'name: my-skill', 'user-invocable: false', '---', '', 'body'].join('\r\n');
  const parsed = parseSkill(md);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.value.data.name, 'my-skill');
  assert.equal(parsed.value.data['user-invocable'], false);
});

test('splitFrontmatter handles a leading BOM', () => {
  const { frontmatter, body } = splitFrontmatter('﻿---\nname: x\n---\nbody\n');
  assert.equal(frontmatter, 'name: x');
  assert.equal(body.trim(), 'body');
});

test('double-quoted values are unescaped as JSON (symmetric with serialization)', () => {
  const parsed = parseSkill('---\nname: x\ndescription: "he said \\"hi\\""\n---\nbody');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.value.data.description, 'he said "hi"');
});

test('single-quoted values are literal with doubled-quote escapes', () => {
  const parsed = parseSkill("---\nname: x\ndescription: 'it''s fine'\n---\nbody");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.value.data.description, "it's fine");
});
