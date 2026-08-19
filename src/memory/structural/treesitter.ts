/**
 * Optional tree-sitter structural tier.
 *
 * v0.1 ships a zero-dependency regex tier (`extract.ts`). This adds a sharper,
 * OPTIONAL tier behind the exact same `Extraction` contract, using
 * `web-tree-sitter` (WASM) + per-language grammar packages. Nothing here is a
 * hard runtime dependency of the published package — an operator opts in with
 * `pnpm add -D web-tree-sitter tree-sitter-typescript tree-sitter-javascript
 * tree-sitter-python`. Every failure mode (package absent, wasm missing, parse
 * error) degrades to the regex tier for that one file, never a hard failure —
 * the same honesty-by-construction pattern `drift.ts` already uses for
 * absence-proof: a tier that cannot parse a file must not pretend it did.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type Edge, type Extraction, extractSymbols, type SymbolKind, type SymbolNode } from './extract.js';

export type ExtractionTier = 'treesitter' | 'regex';

export interface TieredExtraction extends Extraction {
  readonly tier: ExtractionTier;
}

type Lang = 'typescript' | 'tsx' | 'javascript' | 'python' | 'java' | 'kotlin' | 'go' | 'rust';

const GRAMMAR_PACKAGE: Readonly<Record<Lang, string>> = {
  typescript: 'tree-sitter-typescript',
  tsx: 'tree-sitter-typescript',
  javascript: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  java: 'tree-sitter-java',
  kotlin: '@tree-sitter-grammars/tree-sitter-kotlin',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
};

const GRAMMAR_WASM: Readonly<Record<Lang, string>> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  java: 'tree-sitter-java.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
};

/** Node types whose `name` field is a definition site, per language family. */
const JS_DEF_TYPES: Readonly<Record<string, SymbolKind>> = {
  function_declaration: 'function',
  class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  method_definition: 'method',
};
const PY_DEF_TYPES: Readonly<Record<string, SymbolKind>> = {
  function_definition: 'function',
  class_definition: 'class',
};
/**
 * Scoped to declarations only (class/interface/enum/record/method/
 * constructor), matching `PY_DEF_TYPES`'s precedent — no field/local-variable
 * binding extraction for v1. `enum_declaration`/`record_declaration`/
 * `annotation_type_declaration` all map to 'class' (closest `SymbolKind` fit;
 * this codebase doesn't have an enum/record/annotation kind of its own).
 */
const JAVA_DEF_TYPES: Readonly<Record<string, SymbolKind>> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'class',
  record_declaration: 'class',
  annotation_type_declaration: 'interface',
  method_declaration: 'method',
  constructor_declaration: 'method',
};
/**
 * Kotlin's grammar has one `class_declaration` node for class/interface/
 * object alike (distinguished by a modifier token, not a node type) and one
 * `function_declaration` for both top-level functions and class members —
 * so, unlike Java/JS, this tier cannot distinguish 'interface' or 'method'
 * from 'class'/'function' here. Reported honestly as the coarser kind rather
 * than guessed.
 */
const KOTLIN_DEF_TYPES: Readonly<Record<string, SymbolKind>> = {
  class_declaration: 'class',
  object_declaration: 'class',
  function_declaration: 'function',
};
/**
 * Go's grammar gives function vs. method a genuine, unambiguous node-type
 * distinction (`method_declaration` carries a `receiver` field;
 * `function_declaration` never does) — unlike Kotlin, no coarsening needed.
 */
const GO_FUNC_DEF_TYPES: Readonly<Record<string, SymbolKind>> = {
  function_declaration: 'function',
  method_declaration: 'method',
};
/**
 * Rust's `struct`/`enum`/`trait`/`const`/`static`/`type` items all carry an
 * unambiguous node type, matching Java's `enum_declaration`/`record_declaration`
 * -> 'class' precedent for `enum_item`. `function_item` is handled separately
 * (see `walkRustForSymbols`) because Rust reuses the SAME node type for both a
 * free function and an impl-block method — the only way to tell them apart is
 * parent context, which this flat map can't express.
 */
const RUST_DEF_TYPES: Readonly<Record<string, SymbolKind>> = {
  struct_item: 'class',
  enum_item: 'class',
  trait_item: 'interface',
  const_item: 'const',
  static_item: 'const',
  type_item: 'type',
};

export function languageForFile(file: string): Lang | null {
  if (/\.tsx$/i.test(file)) return 'tsx';
  if (/\.ts$/i.test(file)) return 'typescript';
  if (/\.(mjs|cjs|jsx|js)$/i.test(file)) return 'javascript';
  if (/\.py$/i.test(file)) return 'python';
  if (/\.java$/i.test(file)) return 'java';
  if (/\.kts?$/i.test(file)) return 'kotlin';
  if (/\.go$/i.test(file)) return 'go';
  if (/\.rs$/i.test(file)) return 'rust';
  return null;
}

function stripQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/g, '');
}

// Lazily-loaded, cached across calls. `undefined` = not yet attempted,
// `null` = attempted and unavailable (package missing or init failed).
let webTreeSitter: typeof import('web-tree-sitter') | null | undefined;

async function loadModule(): Promise<typeof import('web-tree-sitter') | null> {
  if (webTreeSitter !== undefined) {
    return webTreeSitter;
  }
  try {
    // Dynamic + optional: a project that never installed `web-tree-sitter`
    // must build and run cleanly. This import only resolves when the
    // operator opted in.
    const mod = await import('web-tree-sitter');
    await mod.Parser.init();
    webTreeSitter = mod;
  } catch {
    webTreeSitter = null;
  }
  return webTreeSitter;
}

const languageCache = new Map<Lang, Promise<import('web-tree-sitter').Language | null>>();

function resolveWasmPath(lang: Lang): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve(`${GRAMMAR_PACKAGE[lang]}/package.json`);
    return join(dirname(pkgJson), GRAMMAR_WASM[lang]);
  } catch {
    return null; // grammar package not installed
  }
}

function loadLanguage(
  lang: Lang,
  ts: typeof import('web-tree-sitter'),
): Promise<import('web-tree-sitter').Language | null> {
  const cached = languageCache.get(lang);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    const wasmPath = resolveWasmPath(lang);
    if (!wasmPath) {
      return null;
    }
    try {
      return await ts.Language.load(wasmPath);
    } catch {
      return null;
    }
  })();
  languageCache.set(lang, promise);
  return promise;
}

function walkForSymbols(
  node: import('web-tree-sitter').Node,
  file: string,
  defTypes: Readonly<Record<string, SymbolKind>>,
  nodes: SymbolNode[],
): void {
  const kind = defTypes[node.type];
  if (kind) {
    const name = node.childForFieldName('name')?.text;
    if (name) {
      nodes.push({ name, kind, file, line: node.startPosition.row + 1, confidence: 'extracted' });
    }
  }
  for (const child of node.namedChildren) {
    if (child) {
      walkForSymbols(child, file, defTypes, nodes);
    }
  }
}

function extractJsFamily(file: string, tree: import('web-tree-sitter').Tree): Extraction {
  const nodes: SymbolNode[] = [];
  const root = tree.rootNode;
  walkForSymbols(root, file, JS_DEF_TYPES, nodes);
  // const/let bindings aren't keyed by a single node type shared with the
  // definitions above (both share `variable_declarator`), so pull them
  // separately -- same "any top-level binding" scope the regex tier uses.
  for (const decl of root.descendantsOfType('variable_declarator')) {
    const name = decl.childForFieldName('name')?.text;
    if (name) {
      nodes.push({ name, kind: 'const', file, line: decl.startPosition.row + 1, confidence: 'extracted' });
    }
  }
  const edges: Edge[] = [];
  for (const imp of root.descendantsOfType('import_statement')) {
    const source = imp.childForFieldName('source')?.text;
    if (source) {
      edges.push({ from: file, to: stripQuotes(source), kind: 'imports' });
    }
  }
  for (const call of root.descendantsOfType('call_expression')) {
    if (call.childForFieldName('function')?.text !== 'require') {
      continue;
    }
    const arg = call.childForFieldName('arguments')?.namedChildren[0];
    if (arg?.text) {
      edges.push({ from: file, to: stripQuotes(arg.text), kind: 'imports' });
    }
  }
  return { nodes, edges };
}

function extractPython(file: string, tree: import('web-tree-sitter').Tree): Extraction {
  const nodes: SymbolNode[] = [];
  walkForSymbols(tree.rootNode, file, PY_DEF_TYPES, nodes);
  const edges: Edge[] = [];
  for (const imp of tree.rootNode.descendantsOfType('import_from_statement')) {
    const target = imp.childForFieldName('module_name')?.text;
    if (target) {
      edges.push({ from: file, to: target, kind: 'imports' });
    }
  }
  for (const imp of tree.rootNode.descendantsOfType('import_statement')) {
    const target = imp.childForFieldName('name')?.text;
    if (target) {
      edges.push({ from: file, to: target, kind: 'imports' });
    }
  }
  return { nodes, edges };
}

/**
 * Java/Kotlin: symbol extraction only, no import edges. Both grammars'
 * import nodes carry the imported path as unnamed/untyped children
 * (`import_declaration` in Java has no `fields` at all; Kotlin's import node
 * is similarly field-less) rather than the single named field JS/Python's
 * import statements expose — reconstructing a dotted path would mean
 * concatenating untyped child tokens, which is exactly the kind of
 * low-confidence guess this tier exists to avoid. An empty edge list here is
 * honest; a wrong one would not be.
 */
function extractDeclarationsOnly(
  file: string,
  tree: import('web-tree-sitter').Tree,
  defTypes: Readonly<Record<string, SymbolKind>>,
): Extraction {
  const nodes: SymbolNode[] = [];
  walkForSymbols(tree.rootNode, file, defTypes, nodes);
  return { nodes, edges: [] };
}

function extractGo(file: string, tree: import('web-tree-sitter').Tree): Extraction {
  const nodes: SymbolNode[] = [];
  const root = tree.rootNode;
  walkForSymbols(root, file, GO_FUNC_DEF_TYPES, nodes);
  // `type_spec` (`type X Y`) and `type_alias` (`type X = Y`) share the same
  // `name`/`type` field shape; the `type` field's own node type tells us
  // struct vs. interface vs. anything else (a named type, a slice, a func
  // type, ...), which collapses to 'type' the same way TS's `type_alias_
  // declaration` already does for a non-struct/interface alias.
  for (const spec of [...root.descendantsOfType('type_spec'), ...root.descendantsOfType('type_alias')]) {
    const name = spec.childForFieldName('name')?.text;
    if (!name) continue;
    const underlying = spec.childForFieldName('type')?.type;
    const kind: SymbolKind =
      underlying === 'struct_type' ? 'class' : underlying === 'interface_type' ? 'interface' : 'type';
    nodes.push({ name, kind, file, line: spec.startPosition.row + 1, confidence: 'extracted' });
  }
  // const_spec/var_spec's `name` field is `multiple: true` (Go allows
  // `const A, B = 1, 2`) — childForFieldName only returns the first match, so
  // childrenForFieldName is required here to not silently drop B.
  for (const spec of [...root.descendantsOfType('const_spec'), ...root.descendantsOfType('var_spec')]) {
    for (const id of spec.childrenForFieldName('name')) {
      if (id?.text) {
        nodes.push({ name: id.text, kind: 'const', file, line: id.startPosition.row + 1, confidence: 'extracted' });
      }
    }
  }
  const edges: Edge[] = [];
  for (const imp of root.descendantsOfType('import_spec')) {
    const path = imp.childForFieldName('path')?.text;
    if (path) {
      edges.push({ from: file, to: stripQuotes(path), kind: 'imports' });
    }
  }
  return { nodes, edges };
}

/**
 * Rust reuses `function_item` for both a free function and an impl-block
 * method, so unlike every other language handled by `walkForSymbols`, the
 * kind depends on parent context (is this node a descendant of an
 * `impl_item`?) rather than node type alone. This walker tracks that one bit
 * of context down the tree; everything else (struct/enum/trait/const/
 * static/type) is a flat, unambiguous node-type lookup via `RUST_DEF_TYPES`,
 * same as every other language here.
 */
function walkRustForSymbols(
  node: import('web-tree-sitter').Node,
  file: string,
  nodes: SymbolNode[],
  insideImpl: boolean,
): void {
  if (node.type === 'function_item') {
    const name = node.childForFieldName('name')?.text;
    if (name) {
      nodes.push({
        name,
        kind: insideImpl ? 'method' : 'function',
        file,
        line: node.startPosition.row + 1,
        confidence: 'extracted',
      });
    }
  } else {
    const kind = RUST_DEF_TYPES[node.type];
    if (kind) {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        nodes.push({ name, kind, file, line: node.startPosition.row + 1, confidence: 'extracted' });
      }
    }
  }
  const nextInsideImpl = insideImpl || node.type === 'impl_item';
  for (const child of node.namedChildren) {
    if (child) {
      walkRustForSymbols(child, file, nodes, nextInsideImpl);
    }
  }
}

/**
 * `impl` blocks are deliberately NOT represented as their own node or edge.
 * `SymbolNode`/`Edge` are frozen contracts for this issue (#1/#2's own
 * acceptance criteria), and `EdgeKind` is `'imports'` only — inventing a new
 * edge kind (e.g. `'implements'`) to point an impl block at its type would
 * widen that contract, and reusing `'imports'` for something that isn't an
 * import would be exactly the kind of low-confidence misrepresentation this
 * tier exists to avoid. Instead, the practical value of impl-awareness is
 * captured within the existing contract: a function inside an impl body is
 * correctly classified as 'method' rather than flattened to 'function' (see
 * `walkRustForSymbols`), the same function-vs-method distinction JS/Java
 * already make.
 *
 * `mod` declarations are similarly not extracted as symbol nodes — none of
 * the six `SymbolKind` values accurately describes a module/namespace, and
 * guessing 'class' or 'type' would misrepresent it the same way Java/Kotlin's
 * import paths are left unreconstructed rather than guessed at (see
 * `extractDeclarationsOnly`). Items nested inside a `mod { ... }` block are
 * still found — `walkRustForSymbols` recurses into every named child
 * regardless of whether the current node itself produced a symbol.
 *
 * No import edges: `use_declaration`'s single `argument` field can itself be
 * a deeply nested scoped-use-list / alias / wildcard expression, not a flat
 * path string. Reconstructing a dotted import target would mean parsing that
 * nested shape by hand — the same low-confidence guess Java/Kotlin's import
 * paths already decline (see `extractDeclarationsOnly`).
 */
function extractRust(file: string, tree: import('web-tree-sitter').Tree): Extraction {
  const nodes: SymbolNode[] = [];
  walkRustForSymbols(tree.rootNode, file, nodes, false);
  return { nodes, edges: [] };
}

/**
 * Extract symbols for `file`, preferring the tree-sitter tier and degrading
 * to the regex tier for anything unsupported or unavailable. Never throws —
 * every failure mode is a fallback, matching the contract every other tier
 * in this codebase already honors.
 */
export async function extractSymbolsTiered(file: string, content: string): Promise<TieredExtraction> {
  const lang = languageForFile(file);
  if (lang) {
    const ts = await loadModule();
    const language = ts ? await loadLanguage(lang, ts) : null;
    if (ts && language) {
      const parser = new ts.Parser();
      try {
        parser.setLanguage(language);
        const tree = parser.parse(content);
        if (tree) {
          const extraction =
            lang === 'python'
              ? extractPython(file, tree)
              : lang === 'java'
                ? extractDeclarationsOnly(file, tree, JAVA_DEF_TYPES)
                : lang === 'kotlin'
                  ? extractDeclarationsOnly(file, tree, KOTLIN_DEF_TYPES)
                  : lang === 'go'
                    ? extractGo(file, tree)
                    : lang === 'rust'
                      ? extractRust(file, tree)
                      : extractJsFamily(file, tree);
          tree.delete();
          return { ...extraction, tier: 'treesitter' };
        }
      } catch {
        // parse failure -- fall through to the regex tier below
      } finally {
        parser.delete();
      }
    }
  }
  return { ...extractSymbols(file, content), tier: 'regex' };
}

/** True when the optional tree-sitter tier is actually usable right now (package installed, wasm loadable). */
export async function treeSitterAvailable(): Promise<boolean> {
  return (await loadModule()) !== null;
}
