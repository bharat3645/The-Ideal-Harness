import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUrlSafety, isPrivateOrReservedIp } from '../../src/web/ssrf.js';

test('isPrivateOrReservedIp flags loopback, RFC1918, and link-local (incl. cloud metadata) IPv4', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.1.2.3'), true);
  assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
  assert.equal(isPrivateOrReservedIp('172.31.255.255'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true, 'cloud metadata endpoint');
  assert.equal(isPrivateOrReservedIp('0.0.0.0'), true);
});

test('isPrivateOrReservedIp does not flag ordinary public IPv4 addresses', () => {
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('93.184.216.34'), false);
  // A RFC1918-adjacent-but-public address (172.15.x and 172.32.x are outside the private /12).
  assert.equal(isPrivateOrReservedIp('172.15.0.1'), false);
  assert.equal(isPrivateOrReservedIp('172.32.0.1'), false);
});

test('isPrivateOrReservedIp flags loopback/unique-local/link-local IPv6, incl. IPv4-mapped form', () => {
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('fc00::1'), true);
  assert.equal(isPrivateOrReservedIp('fe80::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true, 'IPv4-mapped IPv6 loopback');
  assert.equal(isPrivateOrReservedIp('::ffff:169.254.169.254'), true, 'IPv4-mapped cloud metadata');
});

test('isPrivateOrReservedIp does not flag an ordinary public IPv6 address', () => {
  assert.equal(isPrivateOrReservedIp('2606:4700:4700::1111'), false);
});

test('checkUrlSafety rejects localhost and *.localhost without any DNS lookup', async () => {
  const failIfCalled = async () => {
    throw new Error('DNS lookup should never be reached for localhost');
  };
  const a = await checkUrlSafety(new URL('http://localhost:8080/admin'), failIfCalled);
  assert.equal(a.safe, false);
  const b = await checkUrlSafety(new URL('http://foo.localhost/'), failIfCalled);
  assert.equal(b.safe, false);
});

test('checkUrlSafety rejects a literal private IP without any DNS lookup', async () => {
  const failIfCalled = async () => {
    throw new Error('DNS lookup should never be reached for an IP literal');
  };
  const result = await checkUrlSafety(new URL('http://169.254.169.254/latest/meta-data/'), failIfCalled);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /private\/reserved IP literal/);
});

test('checkUrlSafety accepts a literal public IP without any DNS lookup', async () => {
  const failIfCalled = async () => {
    throw new Error('DNS lookup should never be reached for an IP literal');
  };
  const result = await checkUrlSafety(new URL('http://8.8.8.8/'), failIfCalled);
  assert.equal(result.safe, true);
});

test('checkUrlSafety resolves a hostname and rejects when ANY resolved address is private (DNS-rebinding-shaped)', async () => {
  const mixedLookup = async () => [{ address: '203.0.113.5' }, { address: '169.254.169.254' }];
  const result = await checkUrlSafety(new URL('http://attacker-controlled.example/'), mixedLookup);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /resolves to a private\/reserved address/);
});

test('checkUrlSafety accepts a hostname whose resolved addresses are all public', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34' }];
  const result = await checkUrlSafety(new URL('http://example.com/'), publicLookup);
  assert.equal(result.safe, true);
});

test('checkUrlSafety fails closed when DNS resolution itself fails', async () => {
  const brokenLookup = async () => {
    throw new Error('ENOTFOUND');
  };
  const result = await checkUrlSafety(new URL('http://does-not-resolve.example/'), brokenLookup);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /DNS resolution failed/);
});

test('decimal-encoded IPv4 loopback is neutralized by URL normalization before this module ever sees it', () => {
  // http://2130706433/ is the classic decimal-IP SSRF bypass (2130706433 === 127.0.0.1).
  // The WHATWG URL parser (used by `new URL()`) normalizes this into dotted-quad form,
  // so `.hostname` is already "127.0.0.1" by the time checkUrlSafety runs.
  const parsed = new URL('http://2130706433/');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(isPrivateOrReservedIp(parsed.hostname), true);
});
