#!/usr/bin/env node

/**
 * `ideal-harness doctor` — one command answering "is everything actually wired?"
 *
 *   node scripts/doctor.mjs [targetProjectDir]
 *
 * targetProjectDir defaults to the current working directory (same convention as
 * scripts/setup.mjs). Doctor never edits anything -- it only reads, probes, and
 * reports, exiting non-zero if any check fails so it's usable as a CI/pre-flight
 * gate. Lives here (not in src/core, which has zero deps) because it inspects
 * guard/memory/compress/orchestrate -- exactly like any Tier-2 consumer, it uses
 * their published dist/ output rather than reaching into module internals, so it
 * never inverts the core-has-no-deps rule the src/ packages are built on.
 *
 * Checks:
 *   1. dist/ is built (all 6 module entry points + all 5 CLI `mcp` entry points)
 *   2. hooks are wired into <target>/.claude/settings.json and point at THIS checkout
 *   3. the 5 MCP servers are registered in <target>/.mcp.json
 *   4. each of the 5 MCP servers actually boots and answers an `initialize` handshake
 *   5. the user policy file (if present) parses cleanly
 *   6. the active floor mode, reported plainly (not a pass/fail -- it's a choice)
 *   7. `.ideal-harness/` is writable (the journal's directory)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Dynamic import() requires a file:// URL for absolute paths on Windows (a bare
// "D:/..." string is parsed as a URL with scheme "d:", not a filesystem path).
const guardModuleUrl = pathToFileURL(join(HARNESS_ROOT, 'dist', 'guard', 'index.js')).href;
const ROOT_POSIX = HARNESS_ROOT.replaceAll('\\', '/');
const target = resolve(process.argv[2] ?? process.cwd());
const MODULES = ['core', 'guard', 'compress', 'memory', 'orchestrate', 'web'];
const MCP_MODULES = ['guard', 'compress', 'memory', 'orchestrate', 'web'];

const posix = (...p) => join(...p).replaceAll('\\', '/');
const cliPath = (pkg) => posix(HARNESS_ROOT, 'dist', pkg, 'cli/index.js');
const readJson = (p) => {
  try {
    return { ok: true, value: JSON.parse(readFileSync(p, 'utf8')) };
  } catch (error) {
    return { ok: false, error: existsSync(p) ? String(error) : `not found: ${p}` };
  }
};
// A hook/server "belongs to us" if it names one of our own files -- checked by
// path SUFFIX, not by requiring the absolute HARNESS_ROOT string. setup.mjs
// writes absolute paths into OTHER projects, but this repo's own checked-in
// dogfood config self-references via relative paths / ${CLAUDE_PROJECT_DIR},
// which never contains HARNESS_ROOT as a substring -- a strict absolute-path
// match would false-negative on the harness's own repo.
const OUR_HOOK_FILES = ['session-start.mjs', 'pretooluse.mjs', 'posttooluse.mjs', 'statusline.mjs'];
const mine = (value) => {
  const s = JSON.stringify(value);
  return s.includes(ROOT_POSIX) || OUR_HOOK_FILES.some((f) => s.includes(f)) || /dist\/[a-z]+\/cli\/index\.js/.test(s);
};

/** @returns {{name: string, ok: boolean, detail: string}} */
function checkDistBuilt() {
  const missing = MODULES.filter((m) => !existsSync(join(HARNESS_ROOT, 'dist', m, 'index.js')));
  const missingCli = MCP_MODULES.filter((m) => !existsSync(cliPath(m)));
  const ok = missing.length === 0 && missingCli.length === 0;
  return {
    name: 'dist built',
    ok,
    detail: ok
      ? `all ${MODULES.length} module + ${MCP_MODULES.length} CLI entry points present`
      : `missing: ${[...missing.map((m) => `${m}/index.js`), ...missingCli.map((m) => `${m}/cli`)].join(', ')} -- run "corepack pnpm build"`,
  };
}

function checkHooksWired() {
  const { ok, value, error } = readJson(join(target, '.claude', 'settings.json'));
  if (!ok) {
    return { name: 'hooks wired', ok: false, detail: `.claude/settings.json: ${error}` };
  }
  const hooks = value.hooks ?? {};
  const need = ['SessionStart', 'PreToolUse', 'PostToolUse'];
  const missing = need.filter((k) => !(hooks[k] ?? []).some(mine));
  return {
    name: 'hooks wired',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${need.join(', ')} all point at this checkout`
        : `missing/foreign: ${missing.join(', ')} -- run "corepack pnpm run setup"`,
  };
}

function checkMcpRegistered() {
  const { ok, value, error } = readJson(join(target, '.mcp.json'));
  if (!ok) {
    return { name: 'MCP servers registered', ok: false, detail: `.mcp.json: ${error}` };
  }
  const servers = value.mcpServers ?? {};
  const missing = MCP_MODULES.filter((m) => !mine(servers[`ideal-harness-${m}`] ?? null));
  return {
    name: 'MCP servers registered',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `all ${MCP_MODULES.length} servers registered`
        : `missing: ${missing.join(', ')} -- run "corepack pnpm run setup"`,
  };
}

/** Spawn a module's `mcp` server, send an `initialize` request, verify a well-formed reply. */
function checkMcpBoots(pkg, timeoutMs = 4000) {
  return new Promise((resolvePromise) => {
    const path = cliPath(pkg);
    if (!existsSync(path)) {
      resolvePromise({ name: `mcp: ${pkg}`, ok: false, detail: 'not built yet' });
      return;
    }
    const child = spawn(process.execPath, [path, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let buffer = '';
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolvePromise(result);
    };
    const timer = setTimeout(
      () => finish({ name: `mcp: ${pkg}`, ok: false, detail: `no response within ${timeoutMs}ms` }),
      timeoutMs,
    );
    child.on('error', (error) => finish({ name: `mcp: ${pkg}`, ok: false, detail: `spawn failed: ${error.message}` }));
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        return;
      }
      const line = buffer.slice(0, newline).trim();
      try {
        const reply = JSON.parse(line);
        const name = reply?.result?.serverInfo?.name;
        finish(
          typeof name === 'string'
            ? { name: `mcp: ${pkg}`, ok: true, detail: `${name} answered initialize` }
            : { name: `mcp: ${pkg}`, ok: false, detail: `malformed initialize reply: ${line}` },
        );
      } catch {
        finish({ name: `mcp: ${pkg}`, ok: false, detail: `non-JSON reply: ${line}` });
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  });
}

async function checkPolicyFile() {
  try {
    const { loadUserPolicy } = await import(guardModuleUrl);
    const policy = loadUserPolicy({ cwd: target });
    const errors = policy.warnings.filter((w) => !w.includes('softened') && !w.includes('disabled via'));
    return {
      name: 'user policy file',
      ok: errors.length === 0,
      detail:
        policy.sources.length === 0
          ? 'none present (defaults only -- fine)'
          : `parsed: ${policy.sources.join(', ')}${policy.warnings.length ? ` -- ${policy.warnings.join('; ')}` : ''}`,
    };
  } catch (error) {
    return { name: 'user policy file', ok: false, detail: `could not load guard module: ${String(error)}` };
  }
}

async function checkFloorMode() {
  try {
    const { floorMode } = await import(guardModuleUrl);
    const mode = floorMode();
    return {
      name: 'floor mode',
      ok: true,
      detail: `${mode}${mode === 'soft' ? ' (default -- denies downgrade to ask)' : mode === 'bypass' ? ' (all permission decisions allowed)' : ' (hard denies active)'}`,
    };
  } catch (error) {
    return { name: 'floor mode', ok: false, detail: `could not load guard module: ${String(error)}` };
  }
}

function checkJournalWritable() {
  const dir = join(target, '.ideal-harness');
  const probe = join(dir, '.doctor-probe');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, 'doctor probe\n', 'utf8');
    rmSync(probe);
    return { name: '.ideal-harness/ writable', ok: true, detail: dir };
  } catch (error) {
    return { name: '.ideal-harness/ writable', ok: false, detail: String(error) };
  }
}

async function main() {
  const results = [
    checkDistBuilt(),
    checkHooksWired(),
    checkMcpRegistered(),
    ...(await Promise.all(MCP_MODULES.map((m) => checkMcpBoots(m)))),
    await checkPolicyFile(),
    await checkFloorMode(),
    checkJournalWritable(),
  ];
  let allOk = true;
  for (const r of results) {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name} -- ${r.detail}`);
    if (!r.ok) {
      allOk = false;
    }
  }
  console.log(allOk ? '\nideal-harness doctor: all checks passed' : '\nideal-harness doctor: FAILED (see above)');
  process.exit(allOk ? 0 : 1);
}

main();
