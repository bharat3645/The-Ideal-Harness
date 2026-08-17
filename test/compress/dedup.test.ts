import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CcrStore } from '../../src/compress/ccr.js';
import { compressToolResult } from '../../src/compress/detect.js';

// Cross-turn dedup (decisions.md D039): the second exact-identical occurrence of
// tool-result content within the same CcrStore's lifetime becomes a pointer to
// the first occurrence instead of being re-emitted. Exact-hash-match only.

const REPEATED = 'the quick brown fox jumps over the lazy dog. '.repeat(60);

test('first occurrence passes through unchanged', () => {
  const store = new CcrStore();
  const result = compressToolResult(REPEATED, { store, dedupe: true });
  assert.equal(result.text, REPEATED);
  assert.notEqual(result.method, 'dedup');
});

test('exact second occurrence becomes a pointer', () => {
  const store = new CcrStore();
  const first = compressToolResult(REPEATED, { store, dedupe: true });
  const second = compressToolResult(REPEATED, { store, dedupe: true });
  assert.equal(first.text, REPEATED);
  assert.equal(second.method, 'dedup');
  assert.match(second.text, /^<<ccr:[0-9a-f]{16}>>$/);
  assert.ok(second.compressedTokens < second.originalTokens);
  assert.ok(second.saved > 0);
});

test('a third exact repeat also resolves to the same pointer', () => {
  const store = new CcrStore();
  compressToolResult(REPEATED, { store, dedupe: true });
  const second = compressToolResult(REPEATED, { store, dedupe: true });
  const third = compressToolResult(REPEATED, { store, dedupe: true });
  assert.equal(second.text, third.text);
  assert.equal(store.size, 1, 'only one copy of the original is ever retained');
});

test('two different sessions (two CcrStore instances) are never deduped against each other', () => {
  const sessionA = new CcrStore();
  const sessionB = new CcrStore();
  compressToolResult(REPEATED, { store: sessionA, dedupe: true });
  const inSessionB = compressToolResult(REPEATED, { store: sessionB, dedupe: true });
  // sessionB has never seen this content before, so it's a first occurrence there too.
  assert.equal(inSessionB.text, REPEATED);
  assert.notEqual(inSessionB.method, 'dedup');
});

test('near-but-not-exact content is not deduped', () => {
  const store = new CcrStore();
  compressToolResult(REPEATED, { store, dedupe: true });
  const almostSame = `${REPEATED} `; // one trailing space — different hash
  const result = compressToolResult(almostSame, { store, dedupe: true });
  assert.notEqual(result.method, 'dedup');
  assert.equal(result.text, almostSame);
});

test('the pointer round-trips back to the original content via store.retrieve', () => {
  const store = new CcrStore();
  compressToolResult(REPEATED, { store, dedupe: true });
  const second = compressToolResult(REPEATED, { store, dedupe: true });
  assert.equal(store.retrieve(second.text), REPEATED);
  assert.equal(store.retrieve(second.marker as string), REPEATED);
});

test('dedupe is opt-in: without the flag, repeats are not pointered', () => {
  const store = new CcrStore();
  compressToolResult(REPEATED, { store });
  const second = compressToolResult(REPEATED, { store });
  assert.notEqual(second.method, 'dedup');
  assert.equal(second.text, REPEATED);
});

test('dedupe with no store provided is a no-op, never throws', () => {
  const result = compressToolResult(REPEATED, { dedupe: true });
  assert.equal(result.text, REPEATED);
});

test('a trivially small repeat is not deduped — the pointer would not actually be cheaper', () => {
  const store = new CcrStore();
  const tiny = 'hi';
  const first = compressToolResult(tiny, { store, dedupe: true });
  const second = compressToolResult(tiny, { store, dedupe: true });
  assert.equal(first.text, tiny);
  assert.equal(second.text, tiny, 'a <<ccr:HASH>> marker is longer than "hi" — never worth it');
  assert.notEqual(second.method, 'dedup');
});

test('dedup composes with recoverable: repeats after a compressed-and-stashed first occurrence still pointer correctly', () => {
  const store = new CcrStore();
  const rows = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, value: `row-${i}`, status: 200 })));
  const first = compressToolResult(rows, { store, recoverable: true, dedupe: true });
  assert.equal(first.method, 'json-array');
  assert.notEqual(first.marker, undefined);

  const second = compressToolResult(rows, { store, recoverable: true, dedupe: true });
  assert.equal(second.method, 'dedup');
  assert.equal(store.retrieve(second.text), rows);
});

test('CcrStore.peekMarker does not insert — a lookup alone never creates a dedup entry', () => {
  const store = new CcrStore();
  assert.equal(store.peekMarker(REPEATED), undefined);
  assert.equal(store.size, 0);
});

test('CcrStore.peekMarker finds an entry stashed directly (not just via compressToolResult)', () => {
  const store = new CcrStore();
  const marker = store.stash(REPEATED);
  assert.equal(store.peekMarker(REPEATED), marker);
});
