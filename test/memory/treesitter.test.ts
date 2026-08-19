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
  assert.equal(languageForFile('a.java'), 'java');
  assert.equal(languageForFile('a.kt'), 'kotlin');
  assert.equal(languageForFile('a.kts'), 'kotlin');
  assert.equal(languageForFile('a.go'), 'go');
  assert.equal(languageForFile('a.rs'), 'rust');
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

test('Java: extracts class/interface/method/constructor at treesitter tier (no import edges — see extractDeclarationsOnly)', async () => {
  const src = [
    'package com.groundwatch.well;',
    'import com.groundwatch.common.Audited;',
    'public interface WellRepository { }',
    'public class WellService implements WellRepository {',
    '  public WellService() {}',
    '  public void recordReading() {}',
    '}',
  ].join('\n');
  const result = await extractSymbolsTiered('WellService.java', src);
  assert.equal(result.tier, 'treesitter');
  const names = result.nodes.map((n) => n.name);
  assert.ok(names.includes('WellRepository'));
  assert.ok(names.includes('WellService'));
  assert.ok(names.includes('recordReading'));
  assert.equal(result.nodes.find((n) => n.name === 'WellRepository')?.kind, 'interface');
  assert.equal(result.nodes.find((n) => n.name === 'WellService')?.kind, 'class');
  assert.equal(result.nodes.find((n) => n.name === 'recordReading')?.kind, 'method');
  // constructor_declaration -> 'method'
  assert.ok(result.nodes.some((n) => n.name === 'WellService' && n.kind === 'method'));
  assert.ok(result.nodes.every((n) => n.confidence === 'extracted'));
  assert.deepEqual(
    result.edges,
    [],
    'Java import edges are intentionally not reconstructed (see extractDeclarationsOnly)',
  );
});

test('Kotlin: extracts class/object/function at treesitter tier', async () => {
  const src = [
    'package com.groundwatch.tod.ui',
    'import androidx.compose.runtime.Composable',
    'object GeofenceGate {',
    '  fun evaluate(radiusM: Double): Boolean { return true }',
    '}',
    'class RoundGate { fun check() {} }',
  ].join('\n');
  const result = await extractSymbolsTiered('RoundGate.kt', src);
  assert.equal(result.tier, 'treesitter');
  const names = result.nodes.map((n) => n.name);
  assert.ok(names.includes('GeofenceGate'));
  assert.ok(names.includes('evaluate'));
  assert.ok(names.includes('RoundGate'));
  assert.ok(names.includes('check'));
  assert.equal(result.nodes.find((n) => n.name === 'GeofenceGate')?.kind, 'class');
  assert.equal(result.nodes.find((n) => n.name === 'RoundGate')?.kind, 'class');
  assert.equal(result.nodes.find((n) => n.name === 'evaluate')?.kind, 'function');
  assert.ok(result.nodes.every((n) => n.confidence === 'extracted'));
});

test('Go: extracts function/method/struct/interface/type/const/var at treesitter tier with import edges', async () => {
  const src = [
    'package widget',
    '',
    'import (',
    '\t"fmt"',
    '\tbar "example.com/foo/bar"',
    ')',
    '',
    'const MaxSize, MinSize = 100, 1',
    'var counter int',
    '',
    'type Widget struct {',
    '\tName string',
    '}',
    '',
    'type Sizer interface {',
    '\tSize() int',
    '}',
    '',
    'type WidgetID = string',
    '',
    'func NewWidget() *Widget { return &Widget{} }',
    '',
    'func (w *Widget) Size() int { return 0 }',
    '',
    'var _ = fmt.Sprint',
    'var _ = bar.X',
  ].join('\n');
  const result = await extractSymbolsTiered('widget.go', src);
  assert.equal(result.tier, 'treesitter');
  const names = result.nodes.map((n) => n.name);
  assert.ok(names.includes('NewWidget'));
  assert.ok(names.includes('Size'));
  assert.ok(names.includes('Widget'));
  assert.ok(names.includes('Sizer'));
  assert.ok(names.includes('WidgetID'));
  assert.ok(names.includes('MaxSize'));
  assert.ok(names.includes('MinSize'));
  assert.ok(names.includes('counter'));
  assert.equal(result.nodes.find((n) => n.name === 'NewWidget')?.kind, 'function');
  assert.equal(result.nodes.find((n) => n.name === 'Size')?.kind, 'method');
  assert.equal(result.nodes.find((n) => n.name === 'Widget')?.kind, 'class');
  assert.equal(result.nodes.find((n) => n.name === 'Sizer')?.kind, 'interface');
  assert.equal(result.nodes.find((n) => n.name === 'WidgetID')?.kind, 'type');
  assert.equal(result.nodes.find((n) => n.name === 'MaxSize')?.kind, 'const');
  assert.equal(result.nodes.find((n) => n.name === 'counter')?.kind, 'const');
  assert.ok(result.nodes.every((n) => n.confidence === 'extracted'));
  assert.ok(result.edges.some((e) => e.to === 'fmt'));
  assert.ok(result.edges.some((e) => e.to === 'example.com/foo/bar'));
});

test('Go: a malformed file falls back to the regex tier without throwing', async () => {
  const result = await extractSymbolsTiered('broken.go', 'package p\nfunc ((( not valid go');
  assert.ok(result.tier === 'treesitter' || result.tier === 'regex');
});

test('Rust: extracts fn/struct/enum/trait/impl-method/mod-nested/const/static/type at treesitter tier, no import edges', async () => {
  const src = [
    'use std::collections::HashMap;',
    '',
    'pub const MAX_SIZE: usize = 100;',
    'static COUNTER: i32 = 0;',
    'type WidgetId = String;',
    '',
    'pub struct Widget {',
    '    name: String,',
    '}',
    '',
    'pub trait Sizer {',
    '    fn size(&self) -> usize;',
    '}',
    '',
    'pub enum Shape {',
    '    Circle,',
    '    Square,',
    '}',
    '',
    'fn free_function() -> i32 { 0 }',
    '',
    'impl Widget {',
    '    fn new() -> Widget { Widget { name: String::new() } }',
    '}',
    '',
    'impl Sizer for Widget {',
    '    fn size(&self) -> usize { 0 }',
    '}',
    '',
    'mod nested {',
    '    pub fn inner_function() {}',
    '}',
  ].join('\n');
  const result = await extractSymbolsTiered('widget.rs', src);
  assert.equal(result.tier, 'treesitter');
  const names = result.nodes.map((n) => n.name);
  assert.ok(names.includes('Widget'));
  assert.ok(names.includes('Sizer'));
  assert.ok(names.includes('Shape'));
  assert.ok(names.includes('MAX_SIZE'));
  assert.ok(names.includes('COUNTER'));
  assert.ok(names.includes('WidgetId'));
  assert.ok(names.includes('free_function'));
  assert.ok(names.includes('new'));
  assert.ok(names.includes('size'));
  assert.ok(names.includes('inner_function'), 'items nested inside `mod { ... }` are still found');
  assert.equal(result.nodes.find((n) => n.name === 'Widget')?.kind, 'class');
  assert.equal(result.nodes.find((n) => n.name === 'Sizer')?.kind, 'interface');
  assert.equal(result.nodes.find((n) => n.name === 'Shape')?.kind, 'class');
  assert.equal(result.nodes.find((n) => n.name === 'MAX_SIZE')?.kind, 'const');
  assert.equal(result.nodes.find((n) => n.name === 'COUNTER')?.kind, 'const');
  assert.equal(result.nodes.find((n) => n.name === 'WidgetId')?.kind, 'type');
  assert.equal(result.nodes.find((n) => n.name === 'free_function')?.kind, 'function');
  assert.equal(
    result.nodes.find((n) => n.name === 'new')?.kind,
    'method',
    'a function inside an impl block is a method, not a free function',
  );
  assert.equal(
    result.nodes.filter((n) => n.name === 'size').length,
    1,
    'the trait method signature (no body) is not itself extracted as a definition site — only the impl carries a body',
  );
  assert.equal(result.nodes.find((n) => n.name === 'size')?.kind, 'method');
  assert.equal(
    result.nodes.find((n) => n.name === 'inner_function')?.kind,
    'function',
    'nested inside `mod`, not `impl` -- confirms the insideImpl flag does not leak across sibling subtrees',
  );
  assert.ok(result.nodes.every((n) => n.confidence === 'extracted'));
  assert.deepEqual(
    result.edges,
    [],
    'Rust import edges are intentionally not reconstructed (see extractRust doc comment)',
  );
});

test('Rust: a malformed file falls back to the regex tier without throwing', async () => {
  const result = await extractSymbolsTiered('broken.rs', 'fn ((( not valid rust');
  assert.ok(result.tier === 'treesitter' || result.tier === 'regex');
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
