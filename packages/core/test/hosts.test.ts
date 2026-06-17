import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSkill } from '../src/skills/frontmatter.js';
import { isHost, renderSkillForHost, serializeFrontmatter } from '../src/skills/hosts.js';

const TEMPLATE = ['---', 'name: demo', 'description: A demo skill', '---', '', 'Body for {{HOST}}.'].join('\n');

test('renders a host-specific skill with host stamped into metadata', () => {
  const parsed = parseSkill(TEMPLATE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const codex = renderSkillForHost(parsed.value, 'codex');
  assert.match(codex, /Body for codex\./);
  // Round-trips back through the parser with metadata.host set.
  const reparsed = parseSkill(codex);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) {
    return;
  }
  assert.equal(reparsed.value.data.name, 'demo');
  assert.deepEqual(reparsed.value.data.metadata, { host: 'codex' });
});

test('serializeFrontmatter quotes ambiguous strings', () => {
  const out = serializeFrontmatter({ a: 'plain', b: 'true', c: 'has: colon', d: [1, 2] });
  assert.match(out, /a: plain/);
  assert.match(out, /b: "true"/);
  assert.match(out, /c: "has: colon"/);
  assert.match(out, /d: \[1, 2\]/);
});

test('isHost guards the union', () => {
  assert.equal(isHost('claude'), true);
  assert.equal(isHost('nope'), false);
});
