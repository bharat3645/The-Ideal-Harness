import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CcrStore, isCompressed } from '../../src/compress/ccr.js';

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

test('constructor rejects a non-positive or non-finite cap', () => {
  assert.throws(() => new CcrStore(0));
  assert.throws(() => new CcrStore(-1));
  assert.throws(() => new CcrStore(Number.NaN));
  assert.throws(() => new CcrStore(Number.POSITIVE_INFINITY));
});

test('evicts least-recently-used entries once the byte cap is exceeded', () => {
  // Cap fits exactly two ~10-byte entries; a third must evict the oldest.
  const store = new CcrStore(25);
  const m1 = store.stash('aaaaaaaaaa'); // 10 bytes
  const m2 = store.stash('bbbbbbbbbb'); // 10 bytes, total 20 <= 25, no eviction yet
  assert.equal(store.size, 2);
  const m3 = store.stash('cccccccccc'); // 10 bytes, total would be 30 > 25 -> evict oldest (m1)
  assert.equal(store.size, 2);
  assert.equal(store.retrieve(m1), undefined, 'oldest entry was evicted');
  assert.equal(store.retrieve(m2), 'bbbbbbbbbb');
  assert.equal(store.retrieve(m3), 'cccccccccc');
});

test('retrieving an entry marks it most-recently-used, protecting it from the next eviction', () => {
  const store = new CcrStore(25);
  const m1 = store.stash('aaaaaaaaaa');
  const m2 = store.stash('bbbbbbbbbb');
  store.retrieve(m1); // touch m1 -> m2 is now the least-recently-used
  store.stash('cccccccccc'); // forces an eviction; should evict m2, not m1
  assert.equal(store.retrieve(m1), 'aaaaaaaaaa', 'touched entry survives');
  assert.equal(store.retrieve(m2), undefined, 'untouched entry was evicted instead');
});

test('a single entry larger than the cap is kept alone rather than evicted', () => {
  const store = new CcrStore(5);
  const marker = store.stash('this payload is well over the five byte cap on its own');
  assert.equal(store.size, 1);
  assert.notEqual(store.retrieve(marker), undefined);
});

test('prune() evicts down to the cap on demand and returns the count evicted', () => {
  const store = new CcrStore(1000);
  for (let i = 0; i < 5; i += 1) {
    store.stash(`payload-${i}`);
  }
  assert.equal(store.size, 5);
  assert.equal(store.prune(), 0, 'no-op while under cap');
});

test('bytes getter tracks total stashed size and shrinks on eviction', () => {
  const store = new CcrStore(1000);
  assert.equal(store.bytes, 0);
  store.stash('aaaaaaaaaa'); // 10 bytes
  assert.equal(store.bytes, 10);
  store.stash('aaaaaaaaaa'); // exact-content dedup: same hash, no double-count
  assert.equal(store.bytes, 10);
  store.stash('bbbbbbbbbb'); // distinct content, 10 more bytes
  assert.equal(store.bytes, 20);
});
