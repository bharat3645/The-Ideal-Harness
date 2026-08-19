import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { pinnedFetch } from '../../src/web/pinned-request.js';

let port: number;
let receivedHost: string | undefined;
const server = createServer((req, res) => {
  receivedHost = req.headers.host;
  if (req.url === '/big') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('x'.repeat(1000));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('hello from the pinned server');
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('pinnedFetch connects to the pinned IP directly, never re-resolving the URL hostname', async () => {
  // ".invalid" is a reserved TLD (RFC 2606) that never resolves in real DNS. If
  // pinnedFetch performed any hostname resolution at all, this would fail or hang.
  // It succeeds only because the connection target is governed entirely by the
  // `pinnedIp` argument, exactly the property that closes the DNS-rebinding gap.
  const url = new URL(`http://this-hostname-does-not-resolve.invalid:${port}/`);
  const res = await pinnedFetch(url, '127.0.0.1');
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  const body = Buffer.from(await res.arrayBuffer()).toString('utf8');
  assert.equal(body, 'hello from the pinned server');
});

test('pinnedFetch preserves the original hostname in the Host header (virtual hosting) even though it connected to a raw IP', async () => {
  const url = new URL(`http://this-hostname-does-not-resolve.invalid:${port}/`);
  await pinnedFetch(url, '127.0.0.1');
  assert.equal(receivedHost, `this-hostname-does-not-resolve.invalid:${port}`);
});

test('pinnedFetch truncates the body at maxBytes rather than buffering the full response', async () => {
  const url = new URL(`http://this-hostname-does-not-resolve.invalid:${port}/big`);
  const res = await pinnedFetch(url, '127.0.0.1', { maxBytes: 100 });
  const body = await res.arrayBuffer();
  assert.equal(body.byteLength, 100);
});

test('pinnedFetch exposes response headers case-insensitively via headers.get', async () => {
  const url = new URL(`http://this-hostname-does-not-resolve.invalid:${port}/`);
  const res = await pinnedFetch(url, '127.0.0.1');
  assert.equal(res.headers.get('Content-Type'), 'text/plain');
  assert.equal(res.headers.get('content-type'), 'text/plain');
});

test('pinnedFetch rejects when aborted via signal', async () => {
  const url = new URL(`http://this-hostname-does-not-resolve.invalid:${port}/`);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => pinnedFetch(url, '127.0.0.1', { signal: controller.signal }));
});

test('pinnedFetch rejects when connecting to an address nothing is listening on', async () => {
  const url = new URL('http://this-hostname-does-not-resolve.invalid:1/');
  await assert.rejects(() => pinnedFetch(url, '127.0.0.1'));
});
