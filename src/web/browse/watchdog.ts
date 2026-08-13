#!/usr/bin/env node
/**
 * Browse daemon watchdog — a standalone entry point (`dist/web/browse/watchdog.js`),
 * spawned detached+unref'd by `daemon.ts`'s `ensureDaemon`, so it outlives the
 * Claude Code tool call that started it.
 *
 * This is what makes idle-shutdown REAL instead of lazy-only: a check that
 * only runs "on the next call" would never fire if nothing calls `browse`
 * again, leaving Chrome running forever. This process is Chrome's actual
 * parent, polls the shared state file's `lastActiveAt` on an interval, and
 * kills Chrome (and itself) once the idle threshold is exceeded — with no
 * dependency on anything calling back in.
 *
 * Usage: node watchdog.js <chromeExe> <userDataDir> <stateFilePath> <idleMs> <startupTimeoutMs>
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { killProcessTree } from '../../guard/index.js';

const DEFAULT_POLL_INTERVAL_MS = 15_000;

const CHROME_ARGS = [
  '--headless=new',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-popup-blocking',
];

interface DaemonState {
  chromePid: number;
  watchdogPid: number;
  port: number;
  webSocketDebuggerUrl: string;
  userDataDir: string;
  startedAt: number;
  lastActiveAt: number;
}

async function writeStateAtomic(path: string, state: DaemonState): Promise<void> {
  // The caller's cwd may be brand new (e.g. a test's fresh tmpdir) — the
  // real bug this fixes: writing straight to a nonexistent .ideal-harness/
  // threw ENOENT every time the daemon started in a directory that hadn't
  // used the harness's state folder yet.
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state), 'utf8');
  await rename(tmp, path);
}

async function waitForDevToolsPort(userDataDir: string, timeoutMs: number): Promise<number> {
  const portFile = `${userDataDir}/DevToolsActivePort`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(portFile, 'utf8');
      const port = Number(raw.split('\n')[0]);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome did not write DevToolsActivePort within ${timeoutMs}ms`);
}

/**
 * `/json/version`'s `webSocketDebuggerUrl` is the BROWSER-level CDP target —
 * it only understands `Target.*`/`Browser.*`, not `Page.*`/`DOM.*`/
 * `Runtime.*` (confirmed live: `Page.enable` returns "wasn't found" against
 * it). `/json/new` creates one page target and returns ITS
 * `webSocketDebuggerUrl`, which is what every page-level command in
 * `actions.ts` actually needs. One page is created here, once, at daemon
 * startup — not per navigate call — so the daemon stays a single warm tab
 * across the whole session, matching the "warm daemon" pattern, not a
 * fresh-tab-per-call model.
 */
async function createPageTarget(port: number, timeoutMs: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) {
    throw new Error('/json/new had no webSocketDebuggerUrl');
  }
  return json.webSocketDebuggerUrl;
}

async function readLastActiveAt(path: string): Promise<number | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DaemonState>;
    return typeof parsed.lastActiveAt === 'number' ? parsed.lastActiveAt : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const [chromeExe, userDataDir, statePath, idleMsArg, startupTimeoutMsArg, pollIntervalMsArg] = process.argv.slice(2);
  if (!chromeExe || !userDataDir || !statePath) {
    process.stderr.write(
      'usage: watchdog.js <chromeExe> <userDataDir> <stateFilePath> <idleMs> <startupTimeoutMs> [pollIntervalMs]\n',
    );
    process.exit(1);
  }
  const idleMs = Number(idleMsArg) || 5 * 60 * 1000;
  const startupTimeoutMs = Number(startupTimeoutMsArg) || 15000;
  const pollIntervalMs = Number(pollIntervalMsArg) || DEFAULT_POLL_INTERVAL_MS;

  const chrome = spawn(chromeExe, [...CHROME_ARGS, `--user-data-dir=${userDataDir}`], {
    stdio: 'ignore',
    windowsHide: true,
  });

  let shuttingDown = false;
  const cleanupAndExit = async (code: number) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (chrome.pid !== undefined) {
      killProcessTree(chrome.pid);
    }
    await rm(statePath, { force: true }).catch(() => undefined);
    // See daemon.ts's shutdownDaemon for why maxRetries/retryDelay matter here on Windows.
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    process.exit(code);
  };

  chrome.on('exit', () => {
    // Chrome died on its own (crash, killed externally) — don't orphan the watchdog.
    void cleanupAndExit(0);
  });
  chrome.on('error', () => {
    void cleanupAndExit(1);
  });

  process.on('SIGTERM', () => void cleanupAndExit(0));
  process.on('SIGINT', () => void cleanupAndExit(0));

  let port: number;
  try {
    port = await waitForDevToolsPort(userDataDir, startupTimeoutMs);
    const webSocketDebuggerUrl = await createPageTarget(port, startupTimeoutMs);
    const now = Date.now();
    await writeStateAtomic(statePath, {
      chromePid: chrome.pid ?? -1,
      watchdogPid: process.pid,
      port,
      webSocketDebuggerUrl,
      userDataDir,
      startedAt: now,
      lastActiveAt: now,
    });
  } catch (error) {
    process.stderr.write(`watchdog: failed to bring up Chrome: ${(error as Error).message}\n`);
    await cleanupAndExit(1);
    return;
  }

  // Idle-shutdown loop — the actual "kills itself with nothing calling back in" behavior.
  const interval = setInterval(async () => {
    const lastActiveAt = await readLastActiveAt(statePath);
    if (lastActiveAt === null) {
      // state file gone — an explicit shutdownDaemon() already ran; just exit quietly.
      clearInterval(interval);
      await cleanupAndExit(0);
      return;
    }
    if (Date.now() - lastActiveAt > idleMs) {
      clearInterval(interval);
      await cleanupAndExit(0);
    }
  }, pollIntervalMs);
}

main();
