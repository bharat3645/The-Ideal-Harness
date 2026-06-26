/**
 * Symbol extraction.
 *
 * v0.1 uses language-agnostic regex extraction with explicit confidence labels
 * (a keyword-prefixed definition is `extracted`; a bare `name(...) {` is
 * `ambiguous`). This is intentionally honest about precision and carries zero
 * dependencies; a tree-sitter backend is the v0.2 upgrade behind the same
 * SymbolNode/Edge contract.
 */

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'method';
export type Confidence = 'extracted' | 'ambiguous';

export interface SymbolNode {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly file: string;
  readonly line: number;
  readonly confidence: Confidence;
}

export type EdgeKind = 'imports';

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
}

export interface Extraction {
  readonly nodes: readonly SymbolNode[];
  readonly edges: readonly Edge[];
}

interface DefRule {
  readonly kind: SymbolKind;
  readonly confidence: Confidence;
  readonly pattern: RegExp;
}

const DEF_RULES: readonly DefRule[] = [
  { kind: 'class', confidence: 'extracted', pattern: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'interface', confidence: 'extracted', pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'type', confidence: 'extracted', pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/ },
  {
    kind: 'function',
    confidence: 'extracted',
    pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  },
  { kind: 'function', confidence: 'extracted', pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_$][\w$]*)\s*\(/ },
  {
    kind: 'const',
    confidence: 'extracted',
    pattern: /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/,
  },
  {
    kind: 'method',
    confidence: 'ambiguous',
    pattern: /^\s*(?:public\s+|private\s+|protected\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
  },
];

const IMPORT_RULES: readonly RegExp[] = [
  /^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/,
  /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/,
];

const RESERVED = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'def', 'class']);

export function extractSymbols(file: string, content: string): Extraction {
  const nodes: SymbolNode[] = [];
  const edges: Edge[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    for (const rule of DEF_RULES) {
      const match = line.match(rule.pattern);
      if (match?.[1] && !RESERVED.has(match[1])) {
        nodes.push({ name: match[1], kind: rule.kind, file, line: index + 1, confidence: rule.confidence });
        break;
      }
    }
    for (const pattern of IMPORT_RULES) {
      const match = line.match(pattern);
      const target = match?.[1] ?? match?.[2];
      if (target) {
        edges.push({ from: file, to: target, kind: 'imports' });
        break;
      }
    }
  });

  return { nodes, edges };
}
