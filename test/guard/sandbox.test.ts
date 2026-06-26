import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSandboxCommand, scrubEnv } from '../../src/guard/sandbox.js';

test('macOS wraps in sandbox-exec with a profile', () => {
  const cmd = buildSandboxCommand(['echo', 'hi'], 'darwin', { workdir: '/repo' });
  assert.equal(cmd.ok, true);
  assert.equal(cmd.argv[0], 'sandbox-exec');
  assert.ok(cmd.argv.join(' ').includes('(deny default)'));
  assert.deepEqual(cmd.argv.slice(-2), ['echo', 'hi']);
});

test('Linux wraps in bwrap and unshares net by default', () => {
  const cmd = buildSandboxCommand(['echo', 'hi'], 'linux', { workdir: '/repo' });
  assert.equal(cmd.ok, true);
  assert.equal(cmd.argv[0], 'bwrap');
  assert.ok(cmd.argv.includes('--unshare-net'));
});

test('Linux keeps network when allowed', () => {
  const cmd = buildSandboxCommand(['echo'], 'linux', { workdir: '/repo', allowNetwork: true });
  assert.equal(cmd.argv.includes('--unshare-net'), false);
});

test('unsupported platform fails closed', () => {
  const cmd = buildSandboxCommand(['echo'], 'other', { workdir: '/repo' });
  assert.equal(cmd.ok, false);
});

test('scrubEnv removes secret-looking keys but keeps allowlisted', () => {
  const scrubbed = scrubEnv(
    { PATH: '/usr/bin', AWS_SECRET_ACCESS_KEY: 'x', API_TOKEN: 'y', HOME: '/h', OPENAI_API_KEY: 'z' },
    ['OPENAI_API_KEY'],
  );
  assert.equal(scrubbed.PATH, '/usr/bin');
  assert.equal(scrubbed.HOME, '/h');
  assert.equal(scrubbed.OPENAI_API_KEY, 'z');
  assert.equal('AWS_SECRET_ACCESS_KEY' in scrubbed, false);
  assert.equal('API_TOKEN' in scrubbed, false);
});
