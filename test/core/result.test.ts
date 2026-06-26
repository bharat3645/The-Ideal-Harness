import assert from 'node:assert/strict';
import { test } from 'node:test';
import { err, isErr, isOk, mapOk, ok, unwrap } from '../../src/core/result.js';

test('ok/err construct and narrow', () => {
  const a = ok(5);
  const b = err(new Error('boom'));
  assert.equal(isOk(a), true);
  assert.equal(isErr(a), false);
  assert.equal(isErr(b), true);
  if (isOk(a)) {
    assert.equal(a.value, 5);
  }
});

test('unwrap returns value or throws', () => {
  assert.equal(unwrap(ok('x')), 'x');
  assert.throws(() => unwrap(err(new Error('nope'))), /nope/);
});

test('mapOk transforms success, passes error through', () => {
  assert.deepEqual(
    mapOk(ok(2), (n) => n * 3),
    ok(6),
  );
  const e = err('bad');
  assert.deepEqual(
    mapOk(e, (n: number) => n * 3),
    e,
  );
});
