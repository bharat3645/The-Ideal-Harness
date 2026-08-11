import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSymbolsTiered, languageForFile, treeSitterAvailable } from '../../src/memory/structural/treesitter.js';

test('tree-sitter tier is available in this dev environment', async () => {
  assert.equal(await treeSitterAvailable(), true);
});

test('languageForFile maps known extensions and rejects unknown ones', () => {
  assert.equal(languageForFile('a.ts'), 'typescript');
  assert.equal(languageForFile('a.tsx'), 'tsx');
  assert.equal(languageForFile('a.js'), 'javascript');
  assert.equal(languageForFile('a.py'), 'python');
  assert.equal(languageForFile('a.md'), null);
});

test('TS: extracts function/class/interface/type/method/const at treesitter tier with import + require edges', async () => {
  const src = [
    'import { x } from "./b.js";',
    'export function doThing() {}',
    'export class Widget { method1() {} }',
    'export interface Foo { a: number }',
    'export type Bar = string;',
    'const value = 1;',
    "const req = require('./legacy');",
  ].join('\n');
  const result = await extractSymbolsTiered('a.ts', src);
  assert.equal(result.tier, 'treesitter');
  const names = result.nodes.map((n) => n.name);
  assert.ok(names.includes('doThing'));
  assert.ok(names.includes('Widget'));
  assert.ok(names.includes('method1'));
  assert.ok(names.includes('Foo'));
  assert.ok(names.includes('Bar'));
  assert.ok(names.includes('value'));
  assert.ok(names.includes('req'));
  // every tree-sitter symbol is precisely located -- never 'ambiguous'.
  assert.ok(result.nodes.every((n) => n.confidence === 'extracted'));
  assert.equal(result.nodes.find((n) => n.name === 'doThing')?.kind, 'function');
  assert.equal(result.nodes.find((n) => n.name === 'Widget')?.kind, 'class');
  assert.equal(result.nodes.find((n) => n.name === 'method1')?.kind, 'method');
  assert.equal(result.nodes.find((n) => n.name === 'Foo')?.kind, 'interface');
  assert.equal(result.nodes.find((n) => n.name === 'Bar')?.kind, 'type');
  assert.ok(result.edges.some((e) => e.to === './b.js'));
  assert.ok(result.edges.some((e) => e.to === './legacy'));
});

test('JS: extracts function + require edge at treesitter tier', async () => {
  const src = ['import { x } from "./b.js";', 'function f() {}', "const y = require('./z');"].join('\n');
  const result = await extractSymbolsTiered('a.js', src);
  assert.equal(result.tier, 'treesitter');
  assert.ok(result.nodes.some((n) => n.name === 'f' && n.kind === 'function'));
  assert.ok(result.edges.some((e) => e.to === './b.js'));
  assert.ok(result.edges.some((e) => e.to === './z'));
});

test('Python: extracts function/class/method at treesitter tier with import + from-import edges', async () => {
  const src = [
    'import os',
    'from foo.bar import baz',
    'def hello():',
    '    pass',
    'class Widget:',
    '    def method1(self):',
    '        pass',
  ].join('\n');
  const result = await extractSymbolsTiered('a.py', src);
  assert.equal(result.tier, 'treesitter');
  const names = result.nodes.map((n) => n.name);
  assert.ok(names.includes('hello'));
  assert.ok(names.includes('Widget'));
  assert.ok(names.includes('method1'));
  assert.ok(result.edges.some((e) => e.to === 'os'));
  assert.ok(result.edges.some((e) => e.to === 'foo.bar'));
});

test('unsupported extension degrades to the regex tier deterministically', async () => {
  const result = await extractSymbolsTiered('README.md', 'export function ghost() {}');
  assert.equal(result.tier, 'regex');
  assert.ok(result.nodes.some((n) => n.name === 'ghost'));
});

test('a syntactically broken file still returns a result instead of throwing', async () => {
  const result = await extractSymbolsTiered('broken.ts', 'export function (((( not valid');
  // tree-sitter is error-tolerant and returns a partial tree; if it somehow
  // still fails, the regex tier is the guaranteed fallback either way.
  assert.ok(result.tier === 'treesitter' || result.tier === 'regex');
});
