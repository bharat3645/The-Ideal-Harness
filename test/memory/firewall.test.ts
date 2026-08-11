import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EpisodicStore } from '../../src/memory/episodic/store.js';
import { buildMemoryTools } from '../../src/memory/runtime/mcp.js';
import { CodeGraph } from '../../src/memory/structural/graph.js';

// A github-token-shaped value, assembled so the literal never appears verbatim.
const FAKE_TOKEN = `gh${'p'}_${'A'.repeat(36)}`;

function harness() {
  const store = new EpisodicStore('git:test');
  const tools = buildMemoryTools(new CodeGraph(), store);
  const by = (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`missing tool ${name}`);
    }
    return tool;
  };
  return { store, write: by('memory_write'), search: by('memory_search'), consolidate: by('memory_consolidate') };
}

test('memory_write redacts secrets before they are ever stored', async () => {
  const { store, write } = harness();
  await write.handler({ type: 'note', text: `deploy key ${FAKE_TOKEN}`, ts: 1 });
  const stored = store.all()[0];
  assert.ok(stored, 'observation was stored');
  assert.ok(!stored.text.includes(FAKE_TOKEN), 'the secret must never reach the store');
  assert.match(stored.text, /\[REDACTED:github-token\]/);
  assert.equal(stored.workspace, 'git:test');
});

test('memory_search fences recalled memory as untrusted data', async () => {
  const { write, search } = harness();
  await write.handler({ type: 'decision', text: 'chose postgres for billing', ts: 1 });
  const out = await search.handler({ query: 'billing', limit: 5 });
  assert.match(out.text, /<untrusted_content source="memory">/);
  assert.match(out.text, /<\/untrusted_content>/);
});

test('memory_write stamps evidence provenance onto the record when provided', async () => {
  const { store, write } = harness();
  await write.handler({
    type: 'decision',
    text: 'chose bm25 over embeddings',
    ts: 1,
    evidence: { overlap: 0.9, matchedTool: 'Edit' },
  });
  const stored = store.all()[0];
  assert.ok(stored);
  assert.deepEqual(stored.evidence, { overlap: 0.9, matchedTool: 'Edit' });
});

test('memory_write leaves evidence absent (not false) when none was checked', async () => {
  const { store, write } = harness();
  await write.handler({ type: 'note', text: 'unverified note', ts: 1 });
  const stored = store.all()[0];
  assert.ok(stored);
  assert.equal(stored.evidence, undefined);
});

test('memory_consolidate dedupes and reports counts through the MCP tool', async () => {
  const { store, write, consolidate } = harness();
  await write.handler({ type: 'note', text: 'the cache expires after sixty seconds', ts: 1 });
  await write.handler({ type: 'note', text: 'the cache expires after sixty seconds exactly', ts: 2 });
  const out = await consolidate.handler({});
  const result = JSON.parse(out.text) as { before: number; after: number; deduped: number };
  assert.equal(result.before, 2);
  assert.equal(result.after, 1);
  assert.equal(result.deduped, 1);
  assert.equal(store.all().length, 1);
});
