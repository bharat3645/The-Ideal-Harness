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

type Lang = 'typescript' | 'tsx' | 'javascript' | 'python';

const GRAMMAR_PACKAGE: Readonly<Record<Lang, string>> = {
  typescript: 'tree-sitter-typescript',
  tsx: 'tree-sitter-typescript',
  javascript: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
};

const GRAMMAR_WASM: Readonly<Record<Lang, string>> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
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

export function languageForFile(file: string): Lang | null {
  if (/\.tsx$/i.test(file)) return 'tsx';
  if (/\.ts$/i.test(file)) return 'typescript';
  if (/\.(mjs|cjs|jsx|js)$/i.test(file)) return 'javascript';
  if (/\.py$/i.test(file)) return 'python';
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
          const extraction = lang === 'python' ? extractPython(file, tree) : extractJsFamily(file, tree);
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
