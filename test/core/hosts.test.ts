import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSkill } from '../../src/core/skills/frontmatter.js';
import { isHost, renderSkillForHost, serializeFrontmatter } from '../../src/core/skills/hosts.js';

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

test('non-object metadata is preserved verbatim, never corrupted into an object', () => {
  // An array metadata must NOT be spread into {0:..,1:..,host}.
  const tmpl = ['---', 'name: demo', 'description: d', 'metadata: [1, 2, 3]', '---', '', 'b'].join('\n');
  const parsed = parseSkill(tmpl);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const reparsed = parseSkill(renderSkillForHost(parsed.value, 'claude'));
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) {
    return;
  }
  assert.deepEqual(reparsed.value.data.metadata, [1, 2, 3]);
});
