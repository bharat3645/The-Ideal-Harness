import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EpisodicStore } from '../../src/memory/episodic/store.js';
import { buildMemoryTools } from '../../src/memory/runtime/mcp.js';
import { CodeGraph } from '../../src/memory/structural/graph.js';

// A github-token-shaped value, assembled so the literal never appears verbatim.
const FAKE_TOKEN = `gh${'p'}_${'A'.repeat(36)}`;

function harness(consolidateEvery?: number) {
  const store = new EpisodicStore('git:test');
  const tools =
    consolidateEvery === undefined
      ? buildMemoryTools(new CodeGraph(), store)
      : buildMemoryTools(
          new CodeGraph(),
          store,
          () => true,
          () => true,
          consolidateEvery,
        );
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

// --- issue #15: memory_write auto-consolidates every N writes, N operator-tunable ---

test('memory_write does NOT auto-consolidate before the Nth write', async () => {
  const { store, write } = harness(3);
  const out1 = await write.handler({ type: 'note', text: 'first observation, quite distinct', ts: 1 });
  const out2 = await write.handler({ type: 'note', text: 'second observation, also distinct', ts: 2 });
  assert.equal(JSON.parse(out1.text).consolidated, undefined, 'no auto-consolidation on write 1 of 3');
  assert.equal(JSON.parse(out2.text).consolidated, undefined, 'no auto-consolidation on write 2 of 3');
  assert.equal(store.all().length, 2);
});

test('memory_write auto-consolidates exactly on the Nth write, and announces it in the response', async () => {
  const { store, write } = harness(3);
  await write.handler({ type: 'note', text: 'the deploy pipeline runs on push to main', ts: 1 });
  await write.handler({ type: 'note', text: 'the deploy pipeline runs on push to main exactly', ts: 2 });
  const out3 = await write.handler({ type: 'note', text: 'a completely unrelated third observation here', ts: 3 });
  const result = JSON.parse(out3.text) as {
    consolidated?: { before: number; after: number; deduped: number; pruned: number };
  };
  assert.ok(result.consolidated, 'write 3 of 3 announces auto-consolidation in its own response');
  assert.equal(result.consolidated?.before, 3);
  assert.equal(result.consolidated?.deduped, 1, 'the two near-identical notes were deduped');
  assert.equal(store.all().length, 2, 'store reflects the deduped result immediately');
});

test('memory_write auto-consolidation never drops decision/failure/security_alert records, even across repeated triggers', async () => {
  const { store, write } = harness(2);
  // 6 permanent-type writes across 3 auto-consolidation triggers (every 2 writes).
  await write.handler({ type: 'decision', text: 'chose postgres for the billing service', ts: 1 });
  await write.handler({ type: 'failure', text: 'redis eviction under load caused a stale read', ts: 2 });
  await write.handler({ type: 'security_alert', text: 'a dependency shipped a vulnerable transitive package', ts: 3 });
  await write.handler({ type: 'decision', text: 'chose bm25 over embeddings for episodic recall', ts: 4 });
  await write.handler({ type: 'failure', text: 'the first sandbox profile leaked network access', ts: 5 });
  await write.handler({ type: 'security_alert', text: 'a skill attempted a homoglyph-obfuscated instruction', ts: 6 });
  const types = store.all().map((o) => o.type);
  assert.equal(types.filter((t) => t === 'decision').length, 2, 'both decisions survived every auto-trigger');
  assert.equal(types.filter((t) => t === 'failure').length, 2, 'both failures survived every auto-trigger');
  assert.equal(types.filter((t) => t === 'security_alert').length, 2, 'both security_alerts survived');
});

test('memory_write auto-consolidation threshold is configurable — different N changes when it fires', async () => {
  const fast = harness(1); // every single write
  const out = await fast.write.handler({ type: 'note', text: 'a lone observation', ts: 1 });
  assert.ok(JSON.parse(out.text).consolidated, 'N=1 auto-consolidates on the very first write');

  const slow = harness(100); // effectively never, within this test
  const out2 = await slow.write.handler({ type: 'note', text: 'a lone observation', ts: 1 });
  assert.equal(JSON.parse(out2.text).consolidated, undefined, 'N=100 does not auto-consolidate on the first write');
});
