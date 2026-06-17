import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SecretsBroker } from '../src/secrets.js';

test('broker grants a secret only to an allowed scope', () => {
  const broker = new SecretsBroker();
  broker.register('DB_URL', 'postgres://secret', ['db-tool']);

  const allowed = broker.request('DB_URL', 'db-tool');
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.value, 'postgres://secret');
  }

  const denied = broker.request('DB_URL', 'web-tool');
  assert.equal(denied.ok, false);
});

test('broker rejects unknown secrets and records access', () => {
  const broker = new SecretsBroker();
  const missing = broker.request('NOPE', 'any');
  assert.equal(missing.ok, false);
  assert.equal(broker.log().length, 1);
  assert.equal(broker.log()[0]?.granted, false);
});
