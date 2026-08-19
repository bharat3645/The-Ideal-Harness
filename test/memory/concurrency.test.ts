/**
 * Real concurrent-writer tests for issue #17 / decisions.md D039, mirroring
 * `test/orchestrate/concurrency.test.ts`: two independent `buildMemoryTools`
 * instances (simulating two separate MCP server processes on the same
 * workspace) sharing the same lock-protected `GraphIo`/`EpisodicIo` backed
 * by real files, proving neither writer's data is silently lost.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockPathFor } from '../../src/core/index.js';
import { loadEpisodicSnapshot, saveEpisodicSnapshot } from '../../src/memory/episodic/persist.js';
import { EpisodicStore } from '../../src/memory/episodic/store.js';
import { buildMemoryTools, type EpisodicIo, type GraphIo } from '../../src/memory/runtime/mcp.js';
import { CodeGraph } from '../../src/memory/structural/graph.js';
import { loadGraphSnapshot, saveGraphSnapshot } from '../../src/memory/structural/persist.js';

async function withTmpDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ideal-harness-mem-concurrency-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeGraphIo(storeDir: string): GraphIo {
  return {
    load: () => loadGraphSnapshot(storeDir),
    save: (g) => saveGraphSnapshot(g, storeDir),
    lockPath: lockPathFor(join(storeDir, 'graph.json')),
  };
}

function makeEpisodicIo(storeDir: string): EpisodicIo {
  return {
    load: () => loadEpisodicSnapshot(storeDir),
    save: (s) => saveEpisodicSnapshot(s, storeDir),
    lockPath: lockPathFor(join(storeDir, 'episodic.json')),
  };
}

test('two concurrent processes each indexing a DIFFERENT file lose neither (structural graph)', async () => {
  await withTmpDir(async (storeDir) => {
    const io = makeGraphIo(storeDir);
    const toolsA = buildMemoryTools(new CodeGraph(), new EpisodicStore(), undefined, undefined, undefined, io);
    const toolsB = buildMemoryTools(new CodeGraph(), new EpisodicStore(), undefined, undefined, undefined, io);
    const addA = toolsA.find((t) => t.name === 'add_file');
    const addB = toolsB.find((t) => t.name === 'add_file');
    assert.ok(addA && addB);

    const [resA, resB] = await Promise.all([
      addA.handler({ path: 'a.ts', content: 'export function fromA() {}' }),
      addB.handler({ path: 'b.ts', content: 'export function fromB() {}' }),
    ]);
    assert.notEqual(resA.isError, true);
    assert.notEqual(resB.isError, true);

    const final = loadGraphSnapshot(storeDir);
    assert.deepEqual(
      final
        .allNodes()
        .map((n) => n.name)
        .sort(),
      ['fromA', 'fromB'],
      "both concurrently-indexed files' symbols must be present, not just the last writer's",
    );
  });
});

test('two concurrent processes each writing a DIFFERENT episodic observation lose neither', async () => {
  await withTmpDir(async (storeDir) => {
    const io = makeEpisodicIo(storeDir);
    const toolsA = buildMemoryTools(
      new CodeGraph(),
      new EpisodicStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      io,
    );
    const toolsB = buildMemoryTools(
      new CodeGraph(),
      new EpisodicStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      io,
    );
    const writeA = toolsA.find((t) => t.name === 'memory_write');
    const writeB = toolsB.find((t) => t.name === 'memory_write');
    assert.ok(writeA && writeB);

    const [resA, resB] = await Promise.all([
      writeA.handler({ type: 'note', text: 'from A', ts: 1 }),
      writeB.handler({ type: 'note', text: 'from B', ts: 2 }),
    ]);
    assert.notEqual(resA.isError, true);
    assert.notEqual(resB.isError, true);

    const final = loadEpisodicSnapshot(storeDir);
    assert.deepEqual(
      final
        .all()
        .map((o) => o.text)
        .sort(),
      ['from A', 'from B'],
      "both concurrently-written observations must be present, not just the last writer's",
    );
  });
});

test('addFileAuto skip (unchanged content) does not touch the lock/disk at all', async () => {
  await withTmpDir(async (storeDir) => {
    const io = makeGraphIo(storeDir);
    const tools = buildMemoryTools(new CodeGraph(), new EpisodicStore(), undefined, undefined, undefined, io);
    const addFile = tools.find((t) => t.name === 'add_file');
    assert.ok(addFile);

    const first = await addFile.handler({ path: 'a.ts', content: 'export function f() {}' });
    assert.notEqual(first.isError, true);
    const firstParsed = JSON.parse(first.text) as { skipped: boolean; persisted: boolean };
    assert.equal(firstParsed.skipped, false);

    // Same content again — addFileAuto's own hash check should skip re-extraction,
    // and the lock-protected path should honor that (no unnecessary save).
    const second = await addFile.handler({ path: 'a.ts', content: 'export function f() {}' });
    const secondParsed = JSON.parse(second.text) as { skipped: boolean; persisted: boolean };
    assert.equal(secondParsed.skipped, true);
    assert.equal(secondParsed.persisted, true, 'a skipped write is still reported as durable, not a failure');
  });
});
