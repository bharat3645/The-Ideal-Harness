#!/usr/bin/env node

/**
 * `ideal-harness report [targetProjectDir] [outputPath]`
 *
 * The "local dashboard" VISION §4.1 names as the seed of an eventual observe
 * layer — scoped honestly to what's actually buildable without a server: one
 * self-contained static HTML file, generated on demand from the project's
 * own on-disk state (guard journal, orchestrate ledger, memory snapshots).
 * No JS framework, no charting library, no background process, no network —
 * open the file in a browser; refresh by re-running the command. Read-only:
 * this script never writes anywhere except the report file itself.
 *
 * Lives here (not in src/core) for the same reason doctor.mjs does: it reads
 * guard/orchestrate/memory's dist/ output like any Tier-2 consumer, without
 * inverting core's zero-deps rule.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// file:// URLs are required for dynamic import() of an absolute path on Windows.
const guardModuleUrl = pathToFileURL(join(HARNESS_ROOT, 'dist', 'guard', 'index.js')).href;
const orchestrateModuleUrl = pathToFileURL(join(HARNESS_ROOT, 'dist', 'orchestrate', 'index.js')).href;

const target = resolve(process.argv[2] ?? process.cwd());
const outputPath = resolve(process.argv[3] ?? join(target, '.ideal-harness', 'report.html'));

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function bar(label, count, max) {
  const pct = max === 0 ? 0 : Math.round((count / max) * 100);
  return `<div class="bar-row"><span class="bar-label">${esc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-count">${count}</span></div>`;
}

async function main() {
  const { parseJournal, verifyJournalChain } = await import(guardModuleUrl);
  const { generateRetro } = await import(orchestrateModuleUrl);

  // --- guard journal ---
  const journalPath = join(target, '.ideal-harness', 'guard-journal.jsonl');
  const journalEntries = existsSync(journalPath) ? parseJournal(readFileSync(journalPath, 'utf8')) : [];
  const byAction = { allow: 0, ask: 0, deny: 0 };
  const byRule = new Map();
  let softenedCount = 0;
  for (const entry of journalEntries) {
    byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
    byRule.set(entry.ruleId, (byRule.get(entry.ruleId) ?? 0) + 1);
    if (entry.softened === true) {
      softenedCount += 1;
    }
  }
  const chain = verifyJournalChain(journalEntries);
  const topRules = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxRuleCount = topRules.length > 0 ? (topRules[0]?.[1] ?? 1) : 1;

  // --- orchestrate ledger ---
  const ledgerDoc = readJsonSafe(join(target, '.ideal-harness', 'orchestrate-ledger.json'));
  const tasks = Array.isArray(ledgerDoc?.tasks) ? ledgerDoc.tasks : [];
  const retroMarkdown = tasks.length > 0 ? generateRetro(tasks, { now: Date.now(), title: 'Ledger' }) : null;

  // --- memory: structural graph ---
  const graphDoc = readJsonSafe(join(target, '.ideal-harness', 'memory', 'graph.json'));
  const files = Array.isArray(graphDoc?.files) ? graphDoc.files : [];
  const treeSitterFiles = files.filter((f) => f.tier === 'treesitter').length;
  const totalNodes = files.reduce((sum, f) => sum + (Array.isArray(f.nodes) ? f.nodes.length : 0), 0);

  // --- memory: episodic store ---
  const episodicDoc = readJsonSafe(join(target, '.ideal-harness', 'memory', 'episodic.json'));
  const observations = Array.isArray(episodicDoc?.observations) ? episodicDoc.observations : [];
  const byType = new Map();
  for (const obs of observations) {
    byType.set(obs.type, (byType.get(obs.type) ?? 0) + 1);
  }
  const maxTypeCount = byType.size > 0 ? Math.max(...byType.values()) : 1;

  const html = renderHtml({
    target,
    generatedAt: new Date().toISOString(),
    journal: { total: journalEntries.length, byAction, softenedCount, chain, topRules, maxRuleCount },
    ledger: { taskCount: tasks.length, retroMarkdown },
    memory: {
      fileCount: files.length,
      treeSitterFiles,
      totalNodes,
      observationCount: observations.length,
      byType: [...byType.entries()],
      maxTypeCount,
    },
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');
  process.stderr.write(`wrote ${outputPath}\n`);
}

function renderHtml(data) {
  const { journal, ledger, memory } = data;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ideal Harness Report</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { margin-bottom: 0.2rem; }
  .meta { color: #888; font-size: 0.85rem; margin-bottom: 2rem; }
  section { margin-bottom: 2.5rem; }
  h2 { border-bottom: 1px solid #8884; padding-bottom: 0.3rem; }
  .stat-grid { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0; }
  .stat { background: #80808014; border-radius: 8px; padding: 0.75rem 1.25rem; min-width: 120px; }
  .stat .n { font-size: 1.6rem; font-weight: 600; display: block; }
  .stat .l { font-size: 0.8rem; color: #888; }
  .bar-row { display: flex; align-items: center; gap: 0.6rem; margin: 0.3rem 0; font-size: 0.9rem; }
  .bar-label { width: 220px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
  .bar-track { flex: 1; background: #80808022; border-radius: 4px; height: 12px; overflow: hidden; }
  .bar-fill { background: #6366f1; height: 100%; }
  .bar-count { width: 3rem; text-align: right; color: #888; font-size: 0.85rem; }
  .ok { color: #16a34a; } .bad { color: #dc2626; }
  pre { background: #80808014; padding: 1rem; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; }
  .empty { color: #888; font-style: italic; }
</style>
</head>
<body>
<h1>Ideal Harness Report</h1>
<p class="meta">${esc(data.target)} — generated ${esc(data.generatedAt)}</p>

<section>
  <h2>Guard journal</h2>
  <div class="stat-grid">
    <div class="stat"><span class="n">${journal.total}</span><span class="l">decisions</span></div>
    <div class="stat"><span class="n">${journal.byAction.allow ?? 0}</span><span class="l">allow</span></div>
    <div class="stat"><span class="n">${journal.byAction.ask ?? 0}</span><span class="l">ask</span></div>
    <div class="stat"><span class="n">${journal.byAction.deny ?? 0}</span><span class="l">deny</span></div>
    <div class="stat"><span class="n">${journal.softenedCount}</span><span class="l">softened (soft mode)</span></div>
    <div class="stat"><span class="n ${journal.chain.ok ? 'ok' : 'bad'}">${journal.chain.ok ? 'intact' : 'BROKEN'}</span><span class="l">hash chain (${journal.chain.checked} checked)</span></div>
  </div>
  ${
    journal.topRules.length > 0
      ? `<h3>Top rules</h3>${journal.topRules.map(([id, count]) => bar(id, count, journal.maxRuleCount)).join('\n')}`
      : '<p class="empty">No journal entries yet.</p>'
  }
</section>

<section>
  <h2>Orchestrate ledger</h2>
  ${
    ledger.retroMarkdown !== null
      ? `<pre>${esc(ledger.retroMarkdown)}</pre>`
      : '<p class="empty">No ledger tasks yet.</p>'
  }
</section>

<section>
  <h2>Memory</h2>
  <div class="stat-grid">
    <div class="stat"><span class="n">${memory.fileCount}</span><span class="l">indexed files</span></div>
    <div class="stat"><span class="n">${memory.totalNodes}</span><span class="l">symbols</span></div>
    <div class="stat"><span class="n">${memory.fileCount > 0 ? Math.round((memory.treeSitterFiles / memory.fileCount) * 100) : 0}%</span><span class="l">at tree-sitter tier</span></div>
    <div class="stat"><span class="n">${memory.observationCount}</span><span class="l">episodic observations</span></div>
  </div>
  ${
    memory.byType.length > 0
      ? memory.byType.map(([type, count]) => bar(type, count, memory.maxTypeCount)).join('\n')
      : '<p class="empty">No episodic observations yet.</p>'
  }
</section>

</body>
</html>
`;
}

main().catch((error) => {
  process.stderr.write(`report failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
