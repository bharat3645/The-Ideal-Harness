import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CcrStore, isCompressed } from '../src/ccr.js';

test('CCR round-trips an original via its marker', () => {
  const store = new CcrStore();
  const original = 'a very large payload '.repeat(100);
  const marker = store.stash(original);
  assert.match(marker, /^<<ccr:[0-9a-f]{16}>>$/);
  assert.equal(store.retrieve(marker), original);
  assert.equal(store.retrieve(marker.match(/[0-9a-f]{16}/)?.[0] ?? ''), original);
});

test('identical content hashes to the same marker', () => {
  const store = new CcrStore();
  assert.equal(store.stash('same'), store.stash('same'));
  assert.equal(store.size, 1);
});

test('isCompressed detects a marker', () => {
  assert.equal(isCompressed('text <<ccr:0123456789abcdef>> more'), true);
  assert.equal(isCompressed('no marker here'), false);
});

test('retrieve returns undefined for an unknown marker', () => {
  assert.equal(new CcrStore().retrieve('<<ccr:ffffffffffffffff>>'), undefined);
});

test('retrieve tolerates an uppercased marker (LLM/copy-paste safe)', () => {
  const store = new CcrStore();
  const marker = store.stash('payload to recover');
  const upper = marker.toUpperCase(); // <<CCR:....>>
  assert.equal(store.retrieve(upper), 'payload to recover');
});
