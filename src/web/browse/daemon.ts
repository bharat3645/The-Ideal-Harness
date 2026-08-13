/**
 * `/browse` warm-Chromium daemon — the gstack-derived pattern DESIGN.md
 * scoped for v0.4/v0.5, honestly reduced from a from-scratch CDP
 * reimplementation (gstack's own is ~24K LOC) to what a single, tested pass
 * can actually deliver: a real process-lifecycle layer using only Node
 * built-ins, an isolated per-daemon Chrome profile (never the operator's
 * real browser/account — the same reasoning `DESIGN.md` already gives for
 * skipping `claude-in-chrome`), atomic state, health auto-start, and true
 * (not lazy-only) idle shutdown via a small companion watchdog process.
 *
 * What this does NOT include, stated plainly: gstack's ONNX/Haiku injection
 * classifier, multi-tab/session management, and drag-and-drop are all
 * out of scope for this pass — `actions.ts` covers navigate/snapshot/
 * click/type/screenshot/evaluate, gated exactly like `web_fetch` (see
 * `decisions.md` D034).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { killProcessTree } from '../../guard/index.js';

/** Set to inherit the watchdog/Chrome's stdio instead of discarding it — a debugging aid, never needed for normal use. */
export const BROWSE_DEBUG_ENV_VAR = 'IDEAL_HARNESS_BROWSE_DEBUG';

export interface DaemonState {
  readonly chromePid: number;
  readonly watchdogPid: number;
  readonly port: number;
  readonly webSocketDebuggerUrl: string;
  readonly userDataDir: string;
  readonly startedAt: number;
  lastActiveAt: number;
}

/** Default idle-shutdown threshold — DESIGN.md's own "idle shutdown" requirement, made concrete. */
export const DEFAULT_IDLE_MS = 5 * 60 * 1000;

export function daemonStatePath(cwd: string = process.cwd()): string {
  return join(cwd, '.ideal-harness', 'browse-daemon.json');
}

export async function readDaemonState(cwd: string = process.cwd()): Promise<DaemonState | null> {
  try {
    const raw = await readFile(daemonStatePath(cwd), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DaemonState>;
    if (
      typeof parsed.chromePid === 'number' &&
      typeof parsed.watchdogPid === 'number' &&
      typeof parsed.port === 'number' &&
      typeof parsed.webSocketDebuggerUrl === 'string' &&
      typeof parsed.userDataDir === 'string' &&
      typeof parsed.startedAt === 'number' &&
      typeof parsed.lastActiveAt === 'number'
    ) {
      return parsed as DaemonState;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write-then-rename — the same atomic-state contract `DESIGN.md` names for this daemon pattern. */
export async function writeDaemonState(state: DaemonState, cwd: string = process.cwd()): Promise<void> {
  const path = daemonStatePath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state), 'utf8');
  await rename(tmp, path);
}

export async function clearDaemonState(cwd: string = process.cwd()): Promise<void> {
  try {
    await rm(daemonStatePath(cwd), { force: true });
  } catch {
    // best-effort
  }
}

/** `process.kill(pid, 0)` signals nothing — it only checks the pid exists and is signalable. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const WELL_KNOWN_PATHS: Readonly<Record<string, readonly string[]>> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

/** `CHROME_PATH`/`PUPPETEER_EXECUTABLE_PATH` first (operator override), then well-known per-platform install paths. Never throws. */
export function findChromeExecutable(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.CHROME_PATH?.trim() || env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (override && existsSync(override)) {
    return override;
  }
  const candidates = WELL_KNOWN_PATHS[process.platform] ?? [];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export interface EnsureDaemonOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly idleMs?: number;
  readonly startupTimeoutMs?: number;
  /** Watchdog's idle-check interval — exposed mainly so tests don't have to wait out a real 15s poll. */
  readonly pollIntervalMs?: number;
}

export interface EnsureDaemonResult {
  readonly ok: boolean;
  readonly state?: DaemonState;
  readonly error?: string;
}

/**
 * Health-check the existing daemon (process alive + `/json/version`
 * reachable); reuse it if healthy, otherwise spawn a fresh one via the
 * watchdog. This IS the "health auto-start" half of the pattern — idle
 * shutdown is the watchdog's job (see `watchdog.ts`), not this function's.
 */
export async function ensureDaemon(options: EnsureDaemonOptions = {}): Promise<EnsureDaemonResult> {
  const {
    cwd = process.cwd(),
    env = process.env,
    idleMs = DEFAULT_IDLE_MS,
    startupTimeoutMs = 15000,
    pollIntervalMs,
  } = options;

  const existing = await readDaemonState(cwd);
  if (existing && isProcessAlive(existing.chromePid)) {
    try {
      await fetch(`http://127.0.0.1:${existing.port}/json/version`, { signal: AbortSignal.timeout(2000) });
      existing.lastActiveAt = Date.now();
      await writeDaemonState(existing, cwd);
      return { ok: true, state: existing };
    } catch {
      // stale/unresponsive — fall through and spawn fresh
    }
  }

  const chromeExe = findChromeExecutable(env);
  if (!chromeExe) {
    return {
      ok: false,
      error:
        'no Chrome/Chromium/Edge executable found — set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH, or install Chrome',
    };
  }

  const userDataDir = await mkdtemp(join(tmpdir(), 'ideal-harness-browse-'));
  const watchdogEntry = join(dirname(fileURLToPath(import.meta.url)), 'watchdog.js');
  const args = [
    watchdogEntry,
    chromeExe,
    userDataDir,
    daemonStatePath(cwd),
    String(idleMs),
    String(startupTimeoutMs),
    ...(pollIntervalMs !== undefined ? [String(pollIntervalMs)] : []),
  ];

  const watchdog = spawn(process.execPath, args, {
    detached: true,
    stdio: env[BROWSE_DEBUG_ENV_VAR] ? 'inherit' : 'ignore',
    windowsHide: true,
  });
  watchdog.unref();

  // The watchdog owns discovery end-to-end (launch Chrome, find its port, create the
  // one warm page target, write state) — waiting for its state file here, rather than
  // this function independently re-deriving the port/ws-url, avoids two processes
  // racing to read the same `DevToolsActivePort` file and diverging on which page
  // target is "the" session's tab.
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(watchdog.pid ?? -1) && watchdog.exitCode !== null) {
      break;
    }
    const state = await readDaemonState(cwd);
    if (state && state.userDataDir === userDataDir) {
      return { ok: true, state };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (watchdog.pid !== undefined) {
    killProcessTree(watchdog.pid);
  }
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  return { ok: false, error: `browse daemon failed to start within ${startupTimeoutMs}ms` };
}

export async function touchActivity(cwd: string = process.cwd()): Promise<void> {
  const state = await readDaemonState(cwd);
  if (state) {
    state.lastActiveAt = Date.now();
    await writeDaemonState(state, cwd).catch(() => undefined);
  }
}

/**
 * Explicit shutdown — kills Chrome and the watchdog, clears state.
 *
 * `maxRetries`/`retryDelay` on the profile-directory removal is not
 * decorative: on Windows, a just-killed process can hold its own SQLite/
 * lock files open for a short window after the kill signal is sent (the OS
 * hasn't finished tearing the handles down yet), so an immediate `rm` can
 * hit `EBUSY` even with `force: true` — `force` only suppresses a missing
 * path, not a locked one. Confirmed live: without retries, this raced and
 * threw during real test runs.
 */
export async function shutdownDaemon(cwd: string = process.cwd()): Promise<boolean> {
  const state = await readDaemonState(cwd);
  if (!state) {
    return false;
  }
  killProcessTree(state.chromePid);
  killProcessTree(state.watchdogPid);
  await clearDaemonState(cwd);
  await rm(state.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  return true;
}
