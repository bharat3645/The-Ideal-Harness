/**
 * Live integration tests against a real Chrome/Chromium binary. Unlike
 * `guard/vet-external.test.ts`'s exec-injection pattern for semgrep/
 * osv-scanner (simple CLI tools whose stdin/stdout are trivially fakeable),
 * a full multi-step CDP browser session is not practically mockable without
 * building a substantial fake CDP server — one that would only prove this
 * test's own mock is self-consistent, not that the real integration works.
 * These tests run for real against whatever Chrome `findChromeExecutable`
 * finds, and skip (not fail) when none is present — the same
 * presence-detected, never-a-hard-failure contract every other optional
 * tier in this codebase already honors (tree-sitter grammars, semgrep,
 * osv-scanner).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluate, navigate, screenshot, snapshot } from '../../../src/web/browse/actions.js';
import { connectCdp } from '../../../src/web/browse/cdp.js';
import {
  ensureDaemon,
  findChromeExecutable,
  isProcessAlive,
  readDaemonState,
  shutdownDaemon,
} from '../../../src/web/browse/daemon.js';

const chromeAvailable = findChromeExecutable() !== null;

test('browse: full session against real Chrome (spawn, navigate, snapshot, screenshot, evaluate, shutdown)', async (t) => {
  if (!chromeAvailable) {
    t.skip('no Chrome/Chromium/Edge found in this environment — set CHROME_PATH to run this test');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-it-'));
  try {
    const result = await ensureDaemon({ cwd: dir, idleMs: 60_000 });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.state);
    assert.ok(isProcessAlive(result.state.chromePid));

    const session = await connectCdp(result.state.webSocketDebuggerUrl);
    try {
      const nav = await navigate(session, 'https://example.com');
      assert.match(nav.url, /^https:\/\/example\.com\/?$/);

      const title = await evaluate(session, 'document.title');
      assert.equal(title, 'Example Domain');

      const els = await snapshot(session);
      assert.ok(els.length > 0, 'example.com has at least one link');
      assert.ok(els[0]?.uid.startsWith('ih'));

      const shot = await screenshot(session);
      assert.ok(shot.base64Png.length > 1000, 'a real PNG screenshot should not be tiny');
    } finally {
      session.close();
    }

    const shutdown = await shutdownDaemon(dir);
    assert.equal(shutdown, true);
    assert.equal(await readDaemonState(dir), null);
    // give the OS a moment to actually reap the process before asserting
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(isProcessAlive(result.state.chromePid), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('browse: a second ensureDaemon call reuses the same warm daemon instead of spawning another', async (t) => {
  if (!chromeAvailable) {
    t.skip('no Chrome/Chromium/Edge found in this environment');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-it-'));
  try {
    const first = await ensureDaemon({ cwd: dir, idleMs: 60_000 });
    assert.equal(first.ok, true);
    const second = await ensureDaemon({ cwd: dir, idleMs: 60_000 });
    assert.equal(second.ok, true);
    assert.equal(second.state?.chromePid, first.state?.chromePid, 'must reuse, not spawn a second Chrome');
  } finally {
    await shutdownDaemon(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('browse: the watchdog genuinely self-terminates on idle — not lazy-reap-on-next-call', async (t) => {
  if (!chromeAvailable) {
    t.skip('no Chrome/Chromium/Edge found in this environment');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ih-browse-it-'));
  try {
    // Fast poll interval so this test doesn't have to wait out a real 15s cycle.
    const result = await ensureDaemon({ cwd: dir, idleMs: 300, pollIntervalMs: 500 });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.state);
    assert.ok(isProcessAlive(result.state.chromePid));

    // Nothing calls back in — no further ensureDaemon/touchActivity — the watchdog
    // must notice on its own that lastActiveAt is stale and kill itself. Poll instead
    // of one fixed sleep: under load (the full suite, real Chrome startup elsewhere)
    // the watchdog's own 500ms poll cadence can slip past a tight single wait.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && isProcessAlive(result.state.chromePid)) {
      await new Promise((r) => setTimeout(r, 250));
    }

    assert.equal(isProcessAlive(result.state.chromePid), false, 'watchdog should have killed Chrome by now');
    assert.equal(await readDaemonState(dir), null, 'watchdog should have cleared state on self-shutdown');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
