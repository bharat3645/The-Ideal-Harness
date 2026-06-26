import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSymbols } from '../../src/memory/structural/extract.js';
import { CodeGraph } from '../../src/memory/structural/graph.js';

test('extracts symbols with confidence labels', () => {
  const { nodes, edges } = extractSymbols(
    'a.ts',
    ['import { x } from "./b.js";', 'export function doThing() {}', 'export class Widget {}', 'const value = 1;'].join(
      '\n',
    ),
  );
  const names = nodes.map((n) => n.name);
  assert.ok(names.includes('doThing'));
  assert.ok(names.includes('Widget'));
  assert.ok(names.includes('value'));
  assert.equal(nodes.find((n) => n.name === 'doThing')?.confidence, 'extracted');
  assert.ok(edges.some((e) => e.kind === 'imports' && e.to === './b.js'));
});

test('subgraph retrieval finds the queried symbol and stays within budget', () => {
  const graph = new CodeGraph();
  graph.addFile('auth.ts', 'export function login() {}\nexport function logout() {}\nconst sessionKey = 1;');
  graph.addFile('util.ts', 'export function unrelatedHelper() {}');
  const result = graph.querySubgraph('login session');
  assert.match(result.text, /login/);
  assert.match(result.text, /auth\.ts/);
  assert.ok(result.nodeCount >= 1);
});

test('subgraph respects a tiny token budget by truncating', () => {
  const graph = new CodeGraph();
  for (let i = 0; i < 50; i += 1) {
    graph.addFile(`f${i}.ts`, `export function handler${i}() {}`);
  }
  const result = graph.querySubgraph('handler', 50);
  assert.equal(result.truncated, true);
});
