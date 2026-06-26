import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactSecrets } from '../../src/guard/redact.js';

test('redacts common secret formats and counts them', () => {
  const input = [
    'aws AKIAIOSFODNN7EXAMPLE',
    'anthropic sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
    'gh ghp_0123456789012345678901234567890123456',
    'bearer Bearer abcdefghijklmnopqrstuvwxyz123456',
  ].join('\n');
  const result = redactSecrets(input);
  assert.equal(result.count >= 4, true);
  assert.match(result.text, /\[REDACTED:aws-access-key\]/);
  assert.match(result.text, /\[REDACTED:anthropic-key\]/);
  assert.doesNotMatch(result.text, /AKIAIOSFODNN7EXAMPLE/);
});

test('leaves clean text untouched', () => {
  const result = redactSecrets('just some normal text, nothing secret here');
  assert.equal(result.count, 0);
  assert.equal(result.text, 'just some normal text, nothing secret here');
});

test('redacts a PEM private key block', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEsomekeydata\n-----END RSA PRIVATE KEY-----';
  const result = redactSecrets(`key:\n${pem}\nend`);
  assert.match(result.text, /\[REDACTED:private-key\]/);
  assert.doesNotMatch(result.text, /somekeydata/);
});
