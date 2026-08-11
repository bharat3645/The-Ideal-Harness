import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CodeGraph } from '../../src/memory/structural/graph.js';
import { graphSnapshotPath, loadGraphSnapshot, saveGraphSnapshot } from '../../src/memory/structural/persist.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ideal-harness-graph-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CodeGraph.serialize/parse round-trips nodes, edges, tier, and hash', () => {
  const graph = new CodeGraph();
  graph.addFile('a.ts', 'export function f() {}');
  const restored = CodeGraph.parse(graph.serialize());
  assert.deepEqual(
    restored.allNodes().map((n) => n.name),
    ['f'],
  );
  assert.deepEqual(restored.fileSymbolSets(), graph.fileSymbolSets());
});

test('CodeGraph.parse skips a corrupt individual file entry rather than failing the whole snapshot', () => {
  const graph = CodeGraph.parse(
    JSON.stringify({ files: [{ file: 'a.ts' /* missing hash */ }, { file: 'b.ts', hash: 'h', nodes: [], edges: [] }] }),
  );
  assert.deepEqual(
    graph.fileSymbolSets().map((s) => s.file),
    ['b.ts'],
  );
});

test('CodeGraph.parse throws on a completely invalid JSON string (callers quarantine it)', () => {
  assert.throws(() => CodeGraph.parse('not json at all'));
});

test('saveGraphSnapshot + loadGraphSnapshot round-trip through the filesystem', () => {
  withTmpDir((dir) => {
    const graph = new CodeGraph();
    graph.addFile('a.ts', 'export class Widget {}');
    assert.equal(saveGraphSnapshot(graph, dir), true);
    assert.ok(existsSync(graphSnapshotPath(dir)));
    const loaded = loadGraphSnapshot(dir);
    assert.deepEqual(
      loaded.allNodes().map((n) => n.name),
      ['Widget'],
    );
  });
});

test('loadGraphSnapshot returns an empty graph when no snapshot exists yet', () => {
  withTmpDir((dir) => {
    const graph = loadGraphSnapshot(dir);
    assert.deepEqual(graph.allNodes(), []);
  });
});

test('loadGraphSnapshot quarantines a corrupt snapshot instead of crashing or looping the failure', () => {
  withTmpDir((dir) => {
    const path = graphSnapshotPath(dir);
    writeFileSync(path, '{not valid json', 'utf8');
    const graph = loadGraphSnapshot(dir);
    assert.deepEqual(graph.allNodes(), []);
    assert.ok(existsSync(`${path}.corrupt`), 'the corrupt file should be preserved for debugging');
    assert.equal(existsSync(path), false, 'the poison-pill path itself should be cleared');
  });
});

test('addFileAuto skips re-extraction when content is unchanged (the incremental lever)', async () => {
  const graph = new CodeGraph();
  const first = await graph.addFileAuto('a.ts', 'export function f() {}');
  assert.equal(first.skipped, false);
  const second = await graph.addFileAuto('a.ts', 'export function f() {}');
  assert.equal(second.skipped, true);
  assert.equal(second.tier, first.tier);
});

test("addFileAuto replaces (never accumulates) a changed file's nodes and edges", async () => {
  const graph = new CodeGraph();
  await graph.addFileAuto('a.ts', 'import "./x.js";\nexport function f() {}');
  await graph.addFileAuto('a.ts', 'import "./y.js";\nexport function g() {}');
  const sets = graph.fileSymbolSets();
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0]?.names, ['g']);
  // querySubgraph must not see the stale './x.js' import as a neighbor edge.
  const node = graph.findByName('g')[0];
  assert.ok(node);
  const neighborFiles = graph.neighbors(node).map((n) => n.file);
  assert.ok(!neighborFiles.includes('x.js'));
});

test('removeFile drops a file from the graph', () => {
  const graph = new CodeGraph();
  graph.addFile('a.ts', 'export function f() {}');
  assert.equal(graph.removeFile('a.ts'), true);
  assert.deepEqual(graph.allNodes(), []);
  assert.equal(graph.removeFile('a.ts'), false);
});
