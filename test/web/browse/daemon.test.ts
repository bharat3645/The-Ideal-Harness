import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  clearDaemonState,
  daemonStatePath,
  findChromeExecutable,
  isProcessAlive,
  readDaemonState,
  writeDaemonState,
} from '../../../src/web/browse/daemon.js';

const sampleState = {
  chromePid: 123,
  watchdogPid: 456,
  port: 9222,
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/ABC',
  userDataDir: '/tmp/whatever',
  startedAt: 1000,
  lastActiveAt: 1000,
};

test('daemonStatePath is <cwd>/.ideal-harness/browse-daemon.json', () => {
  assert.equal(daemonStatePath('/x'), join('/x', '.ideal-harness', 'browse-daemon.json'));
});

test('writeDaemonState / readDaemonState round-trips, atomically (write-then-rename)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-'));
  try {
    await writeDaemonState({ ...sampleState }, dir);
    const read = await readDaemonState(dir);
    assert.deepEqual(read, sampleState);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDaemonState returns null when no state file exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-'));
  try {
    const read = await readDaemonState(dir);
    assert.equal(read, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDaemonState returns null (not a throw) on malformed JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-'));
  try {
    mkdirSync(dirname(daemonStatePath(dir)), { recursive: true });
    writeFileSync(daemonStatePath(dir), '{ not valid json', 'utf8');
    const read = await readDaemonState(dir);
    assert.equal(read, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDaemonState returns null when required fields are missing (never half-trusts a shape)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-'));
  try {
    mkdirSync(dirname(daemonStatePath(dir)), { recursive: true });
    writeFileSync(daemonStatePath(dir), JSON.stringify({ chromePid: 1 }), 'utf8');
    const read = await readDaemonState(dir);
    assert.equal(read, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearDaemonState removes the file and is a no-op (not a throw) when nothing exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-'));
  try {
    await writeDaemonState({ ...sampleState }, dir);
    await clearDaemonState(dir);
    assert.equal(await readDaemonState(dir), null);
    await clearDaemonState(dir); // second call, nothing there — must not throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isProcessAlive: true for this process itself, false for a pid unlikely to exist', () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(999_999_999), false);
});

test('findChromeExecutable: CHROME_PATH override wins when the file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-'));
  try {
    const fakeChrome = join(dir, 'fake-chrome.exe');
    writeFileSync(fakeChrome, '', 'utf8');
    const found = findChromeExecutable({ CHROME_PATH: fakeChrome });
    assert.equal(found, fakeChrome);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findChromeExecutable: a nonexistent override is ignored, falls through to well-known paths', () => {
  const found = findChromeExecutable({ CHROME_PATH: '/definitely/does/not/exist/chrome' });
  // Whatever this returns (a real install or null), it must not be the bogus override path.
  assert.notEqual(found, '/definitely/does/not/exist/chrome');
});

test('findChromeExecutable: never throws when nothing is configured or installed', () => {
  assert.doesNotThrow(() => findChromeExecutable({}));
});
