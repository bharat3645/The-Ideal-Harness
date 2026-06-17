import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compressStackTrace } from '../src/compressors/errors.js';
import { compressJsonArray } from '../src/compressors/json.js';
import { compressLog } from '../src/compressors/log.js';

test('json array sampling keeps anomalies and omits the bulk', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, status: 200 }));
  rows[25] = { id: 25, status: 500 }; // anomaly in the omitted middle
  const result = compressJsonArray(rows);
  assert.notEqual(result, null);
  if (result === null) {
    return;
  }
  assert.ok(result.omitted > 0);
  assert.ok(result.anomaliesKept >= 1);
  assert.match(result.text, /"status":500/);
});

test('json array compression declines on small arrays', () => {
  assert.equal(compressJsonArray([1, 2, 3]), null);
});

test('log RLE collapses repeated templated lines', () => {
  const log = ['conn 1 ok', 'conn 2 ok', 'conn 3 ok', 'conn 4 ok', 'done'].join('\n');
  const result = compressLog(log);
  assert.notEqual(result, null);
  if (result === null) {
    return;
  }
  assert.equal(result.collapsed, 3);
  assert.match(result.text, /×4/);
});

test('stack-trace collapse keeps head frames and counts the rest', () => {
  const frames = Array.from({ length: 12 }, (_, i) => `    at fn${i} (file.js:${i}:1)`);
  const trace = ['Error: boom', ...frames].join('\n');
  const result = compressStackTrace(trace);
  assert.notEqual(result, null);
  if (result === null) {
    return;
  }
  assert.match(result.text, /more frames/);
  assert.ok(result.framesDropped > 0);
  assert.match(result.text, /Error: boom/);
});
