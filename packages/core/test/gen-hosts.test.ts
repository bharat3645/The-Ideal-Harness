import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runGenHosts } from '../src/cli/gen-hosts.js';

test('gen-hosts fails (exit 1) when every requested host is invalid', async () => {
  // Returns before touching the filesystem, so no real template is needed.
  const code = await runGenHosts(['tmpl', 'out', '--hosts=nope,bogus']);
  assert.equal(code, 1);
});

test('gen-hosts returns a usage error without template/outDir', async () => {
  assert.equal(await runGenHosts([]), 1);
});
