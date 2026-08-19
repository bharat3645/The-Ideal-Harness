import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DnsLookupFn } from '../../src/web/ssrf.js';
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

test('isPrivateOrReservedIp flags the hex-compressed form of an IPv4-mapped address (what the WHATWG URL parser actually produces)', () => {
  assert.equal(isPrivateOrReservedIp('::ffff:7f00:1'), true, 'hex form of ::ffff:127.0.0.1');
  assert.equal(isPrivateOrReservedIp('::ffff:a9fe:a9fe'), true, 'hex form of ::ffff:169.254.169.254 (cloud metadata)');
  assert.equal(isPrivateOrReservedIp('::ffff:808:808'), false, 'hex form of ::ffff:8.8.8.8 (public)');
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

test('checkUrlSafety rejects a bracketed IPv6 loopback literal via the literal-IP fast path, not a failed DNS lookup', async () => {
  const failIfCalled = async () => {
    throw new Error('DNS lookup should never be reached for a bracketed IPv6 literal');
  };
  const result = await checkUrlSafety(new URL('http://[::1]/'), failIfCalled);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /private\/reserved IP literal/);
});

test('checkUrlSafety rejects a bracketed IPv4-mapped IPv6 loopback literal', async () => {
  const failIfCalled = async () => {
    throw new Error('DNS lookup should never be reached for a bracketed IPv6 literal');
  };
  const result = await checkUrlSafety(new URL('http://[::ffff:127.0.0.1]/'), failIfCalled);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /private\/reserved IP literal/);
});

test('checkUrlSafety rejects a bracketed IPv6 link-local literal', async () => {
  const failIfCalled = async () => {
    throw new Error('DNS lookup should never be reached for a bracketed IPv6 literal');
  };
  const result = await checkUrlSafety(new URL('http://[fe80::1]/'), failIfCalled);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /private\/reserved IP literal/);
});

test('checkUrlSafety accepts a legitimate public bracketed IPv6 literal (previously broken: blocked via a failed DNS lookup instead)', async () => {
  const failIfCalled = async () => {
    throw new Error('DNS lookup should never be reached for a bracketed IPv6 literal');
  };
  // Cloudflare's public IPv6 resolver -- a real, non-reserved address.
  const result = await checkUrlSafety(new URL('http://[2606:4700:4700::1111]/'), failIfCalled);
  assert.equal(result.safe, true);
});

test('decimal-encoded IPv4 loopback is neutralized by URL normalization before this module ever sees it', () => {
  // http://2130706433/ is the classic decimal-IP SSRF bypass (2130706433 === 127.0.0.1).
  // The WHATWG URL parser (used by `new URL()`) normalizes this into dotted-quad form,
  // so `.hostname` is already "127.0.0.1" by the time checkUrlSafety runs.
  const parsed = new URL('http://2130706433/');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(isPrivateOrReservedIp(parsed.hostname), true);
});

// --- DNS-rebinding gap (ROADMAP.md #5, supersedes decisions.md D026) -------------------
// checkUrlSafety must hand back the EXACT address it validated so a caller can pin the
// real connection to it -- see pinned-request.test.ts for the connection-level proof
// that a pinned request never re-resolves the hostname. These tests cover the half of
// the contract that lives in this module: does `pinnedIp` actually match what was
// validated, deterministically, rather than being left for the runtime to re-resolve.

test('checkUrlSafety returns pinnedIp equal to the literal IP for a literal-IP URL', async () => {
  const result = await checkUrlSafety(new URL('http://93.184.216.34/'));
  assert.equal(result.safe, true);
  assert.equal(result.pinnedIp, '93.184.216.34');
});

test('checkUrlSafety returns pinnedIp equal to the resolved address for a hostname URL', async () => {
  const fakeLookup: DnsLookupFn = async () => [{ address: '203.0.113.9' }];
  // 203.0.113.0/24 is TEST-NET-3 (RFC 5737) -- reserved for documentation, so it must be
  // rejected as unsafe by this module's own rules. Use a genuinely public-looking address
  // instead so this test exercises the "safe" path, not the private-address rejection.
  const publicLookup: DnsLookupFn = async () => [{ address: '93.184.216.34' }];
  const rejected = await checkUrlSafety(new URL('http://example.com/'), fakeLookup);
  assert.equal(rejected.safe, false, 'sanity check: TEST-NET-3 must still be rejected');
  const result = await checkUrlSafety(new URL('http://example.com/'), publicLookup);
  assert.equal(result.safe, true);
  assert.equal(result.pinnedIp, '93.184.216.34', 'pinnedIp must be exactly the address that was validated');
});

test('checkUrlSafety pins deterministically to the FIRST resolved address when DNS returns several', async () => {
  const multiLookup: DnsLookupFn = async () => [{ address: '93.184.216.34' }, { address: '1.1.1.1' }];
  const result = await checkUrlSafety(new URL('http://example.com/'), multiLookup);
  assert.equal(result.safe, true);
  assert.equal(result.pinnedIp, '93.184.216.34', 'must pin to resolved[0], not an arbitrary/later address');
});

test('checkUrlSafety returns no pinnedIp when unsafe -- a caller must never pin to an unvalidated address', async () => {
  const privateLookup: DnsLookupFn = async () => [{ address: '10.0.0.5' }];
  const result = await checkUrlSafety(new URL('http://internal.example/'), privateLookup);
  assert.equal(result.safe, false);
  assert.equal(result.pinnedIp, undefined);
});

test('DNS-rebinding scenario: a hostname whose DNS answer differs between two calls only ever pins to what a SINGLE checkUrlSafety call actually validated', async () => {
  // Simulates the classic rebinding attacker: first answer is public, second is private.
  // checkUrlSafety only ever calls the lookup function ONCE per invocation (it does not
  // re-resolve internally), so pinnedIp reflects exactly one DNS answer -- the one this
  // specific call validated -- never a later, different answer from a follow-up lookup.
  let callCount = 0;
  const rebindingLookup: DnsLookupFn = async () => {
    callCount += 1;
    return callCount === 1 ? [{ address: '93.184.216.34' }] : [{ address: '169.254.169.254' }];
  };
  const first = await checkUrlSafety(new URL('http://rebinding.example/'), rebindingLookup);
  assert.equal(first.safe, true);
  assert.equal(first.pinnedIp, '93.184.216.34');
  assert.equal(callCount, 1, 'checkUrlSafety must resolve exactly once per call, not internally retry/re-check');
});
