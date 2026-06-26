#!/usr/bin/env node
/**
 * Wire The Ideal Harness into a project without hand-editing config.
 *
 *   node scripts/setup.mjs [targetProjectDir]
 *
 * targetProjectDir defaults to the current working directory. One built checkout
 * of this repo can govern any number of projects on the machine — this script
 * just points a target project's config at this checkout's hooks and CLIs.
 *
 * Idempotently merges (preserving any unrelated keys / foreign hooks):
 *   <target>/.claude/settings.json : SessionStart + PreToolUse + PostToolUse hooks
 *   <target>/.mcp.json             : the four engine MCP servers
 *
 * Re-running is safe: it replaces only the entries that point at THIS checkout.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_POSIX = HARNESS_ROOT.replaceAll('\\', '/');
const target = resolve(process.argv[2] ?? process.cwd());

// Preflight: the package must be built (hooks import from dist/, CLIs live in dist/).
if (!existsSync(join(HARNESS_ROOT, 'dist/guard/index.js'))) {
  console.error('The Ideal Harness is not built yet. Run:\n  corepack pnpm run build\nthen re-run this script.');
  process.exit(1);
}

const posix = (...p) => join(...p).replaceAll('\\', '/');
const hookCmd = (file) => `node "${posix(HARNESS_ROOT, 'hooks', file)}"`;
const cliPath = (pkg) => posix(HARNESS_ROOT, 'dist', pkg, 'cli/index.js');

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
};
const writeJson = (p, o) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`);
};

// A hook group "belongs to us" if it references this checkout — drop those before
// re-adding, so foreign hooks survive and ours don't duplicate on re-run.
const mine = (group) => JSON.stringify(group).includes(ROOT_POSIX);
const replaceOurs = (arr, entry) => [...(arr ?? []).filter((g) => !mine(g)), entry];

// ---- .claude/settings.json : hooks ----
const settingsPath = join(target, '.claude', 'settings.json');
const settings = readJson(settingsPath);
settings.hooks ??= {};
settings.hooks.SessionStart = replaceOurs(settings.hooks.SessionStart, {
  hooks: [{ type: 'command', command: hookCmd('session-start.mjs') }],
});
settings.hooks.PreToolUse = replaceOurs(settings.hooks.PreToolUse, {
  matcher: '*',
  hooks: [{ type: 'command', command: hookCmd('pretooluse.mjs') }],
});
settings.hooks.PostToolUse = replaceOurs(settings.hooks.PostToolUse, {
  matcher: '*',
  hooks: [{ type: 'command', command: hookCmd('posttooluse.mjs') }],
});
// statusLine: the compress module's context-window meter. Claim the slot only if it is
// empty or already ours (mine()) — a foreign statusline is never clobbered, mirroring replaceOurs.
const ourStatusLine = { type: 'command', command: hookCmd('statusline.mjs') };
if (!settings.statusLine || mine(settings.statusLine)) {
  settings.statusLine = ourStatusLine;
}
writeJson(settingsPath, settings);

// ---- .mcp.json : engine MCP servers ----
const mcpPath = join(target, '.mcp.json');
const mcp = readJson(mcpPath);
mcp.mcpServers ??= {};
for (const pkg of ['guard', 'compress', 'memory', 'orchestrate']) {
  mcp.mcpServers[`ideal-harness-${pkg}`] = { command: 'node', args: [cliPath(pkg), 'mcp'] };
}
writeJson(mcpPath, mcp);

console.log(`Wired The Ideal Harness (${ROOT_POSIX}) into:\n  ${target}`);
console.log('\nNext:');
console.log('  1. Restart the Claude Code session in that project (hooks load at session start).');
console.log('  2. Approve the 4 ideal-harness MCP servers when prompted (one-time trust gate).');
console.log('  3. The bottom statusline now shows the context-window meter (IH <used>/<window> <pct>%).');
