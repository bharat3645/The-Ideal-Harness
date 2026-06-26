/**
 * Code graph + token-budgeted subgraph retrieval.
 *
 * The retrieval primitive that replaces "re-read whole files": given a query,
 * score symbol nodes, expand to neighbors (same file + directly imported
 * files), and render a structural answer (name/kind/file:line) that fits a
 * token budget. The agent gets a map, not a file dump.
 */

import { type Edge, extractSymbols, type SymbolNode } from './extract.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function moduleMatchesFile(moduleTarget: string, file: string): boolean {
  const cleaned = moduleTarget.replace(/^\.\//, '').replace(/\.[jt]sx?$/, '');
  const fileBase = file.replace(/\.[jt]sx?$/, '');
  return cleaned.length > 0 && fileBase.endsWith(cleaned);
}

export interface SubgraphResult {
  readonly text: string;
  readonly nodeCount: number;
  readonly truncated: boolean;
}

export class CodeGraph {
  private readonly byFile = new Map<string, readonly SymbolNode[]>();
  private readonly imports: Edge[] = [];

  addFile(file: string, content: string): void {
    const { nodes, edges } = extractSymbols(file, content);
    this.byFile.set(file, nodes);
    this.imports.push(...edges);
  }

  allNodes(): SymbolNode[] {
    return [...this.byFile.values()].flat();
  }

  findByName(name: string): SymbolNode[] {
    return this.allNodes().filter((node) => node.name === name);
  }

  /** Same-file symbols plus symbols in files this node's file directly imports. */
  neighbors(node: SymbolNode): SymbolNode[] {
    const sameFile = (this.byFile.get(node.file) ?? []).filter((n) => n !== node);
    const importedTargets = this.imports.filter((e) => e.from === node.file).map((e) => e.to);
    const importedNodes: SymbolNode[] = [];
    for (const [file, nodes] of this.byFile) {
      if (file !== node.file && importedTargets.some((t) => moduleMatchesFile(t, file))) {
        importedNodes.push(...nodes);
      }
    }
    return [...sameFile, ...importedNodes].slice(0, 24);
  }

  private score(node: SymbolNode, terms: readonly string[]): number {
    const name = node.name.toLowerCase();
    let s = 0;
    for (const term of terms) {
      if (name === term) {
        s += 3;
      } else if (name.includes(term)) {
        s += 1;
      }
    }
    if (s > 0 && node.confidence === 'extracted') {
      s += 0.5;
    }
    return s;
  }

  /** Retrieve a structural subgraph relevant to `query`, within `tokenBudget`. */
  querySubgraph(query: string, tokenBudget = 2000): SubgraphResult {
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((t) => t.length > 1);

    const scored = this.allNodes()
      .map((node) => ({ node, score: this.score(node, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const seeds = scored.slice(0, 8).map((entry) => entry.node);
    const included = new Map<string, SymbolNode>();
    const key = (n: SymbolNode): string => `${n.file}:${n.line}:${n.name}`;
    for (const seed of seeds) {
      included.set(key(seed), seed);
      for (const neighbor of this.neighbors(seed)) {
        if (!included.has(key(neighbor))) {
          included.set(key(neighbor), neighbor);
        }
      }
    }

    const lines: string[] = [`# Subgraph for: ${query}`];
    let truncated = false;
    let count = 0;
    for (const node of included.values()) {
      const line = `- ${node.name} (${node.kind}) — ${node.file}:${node.line}${node.confidence === 'ambiguous' ? ' [ambiguous]' : ''}`;
      if (estimateTokens([...lines, line].join('\n')) > tokenBudget) {
        truncated = true;
        break;
      }
      lines.push(line);
      count += 1;
    }

    return { text: lines.join('\n'), nodeCount: count, truncated };
  }
}
