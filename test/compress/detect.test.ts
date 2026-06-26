import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CcrStore } from '../../src/compress/ccr.js';
import { compressToolResult, frozenFloor } from '../../src/compress/detect.js';

test('compresses a large JSON array and reports real savings', () => {
  const rows = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, value: `row-${i}`, status: 200 })));
  const result = compressToolResult(rows);
  assert.equal(result.method, 'json-array');
  assert.ok(result.saved > 0);
  assert.ok(result.compressedTokens < result.originalTokens);
});

test('token gate: incompressible content is returned unchanged', () => {
  const result = compressToolResult('short and unique text, nothing to gain');
  assert.equal(result.method, 'none');
  assert.equal(result.saved, 0);
});

test('idempotent: already-compressed content is not recompressed', () => {
  const result = compressToolResult('payload <<ccr:0123456789abcdef>>');
  assert.equal(result.method, 'none');
});

test('recoverable mode stashes the original and appends a marker', () => {
  const store = new CcrStore();
  const rows = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, status: 200 })));
  const result = compressToolResult(rows, { store, recoverable: true });
  assert.notEqual(result.marker, undefined);
  assert.equal(store.retrieve(result.marker as string), rows);
  // markerTokens is disclosed and the reported saving is net of it.
  assert.ok((result.markerTokens ?? 0) > 0);
  assert.equal(result.saved, result.originalTokens - result.compressedTokens);
});

test('recoverable mode never strands an original when the token gate rejects it', () => {
  // A barely-compressible array: the marker overhead must be weighed BEFORE the
  // stash, so a rejected (method:none) result leaves nothing behind in the store.
  const store = new CcrStore();
  const rows = JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ i })));
  const result = compressToolResult(rows, { store, recoverable: true });
  if (result.method === 'none') {
    assert.equal(result.marker, undefined);
    assert.equal(store.size, 0, 'no original should be stranded in the store on a no-op');
  }
});

test('frozenFloor returns the index after the last cache breakpoint', () => {
  assert.equal(frozenFloor([{ cacheControl: true }, {}, { cacheControl: true }, {}]), 3);
  assert.equal(frozenFloor([{}, {}]), 0);
});
