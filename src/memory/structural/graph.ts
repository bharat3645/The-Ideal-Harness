/**
 * Code graph + token-budgeted subgraph retrieval.
 *
 * The retrieval primitive that replaces "re-read whole files": given a query,
 * score symbol nodes, expand to neighbors (same file + directly imported
 * files), and render a structural answer (name/kind/file:line) that fits a
 * token budget. The agent gets a map, not a file dump.
 *
 * Each file is tracked with its extraction tier (`regex` or the optional
 * `treesitter` tier — see `treesitter.ts`) and a content hash, so the graph
 * can be persisted (`serialize`/`parse`) and incrementally re-indexed:
 * `addFileAuto` skips re-extraction when a file's content hasn't changed, and
 * REPLACES (never accumulates) that file's nodes/edges when it has — the
 * fix for the flat-array-of-edges shape that would otherwise duplicate
 * imports on every re-index of a changed file.
 */

import { createHash } from 'node:crypto';
import { type Edge, extractSymbols, type SymbolNode } from './extract.js';
import { type ExtractionTier, extractSymbolsTiered } from './treesitter.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function moduleMatchesFile(moduleTarget: string, file: string): boolean {
  const cleaned = moduleTarget.replace(/^\.\//, '').replace(/\.[jt]sx?$/, '');
  const fileBase = file.replace(/\.[jt]sx?$/, '');
  return cleaned.length > 0 && fileBase.endsWith(cleaned);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface SubgraphResult {
  readonly text: string;
  readonly nodeCount: number;
  readonly truncated: boolean;
}

/** Per-file symbol names + the tier that extracted them — drift-guard's structural-verification input. */
export interface FileSymbolSet {
  readonly file: string;
  readonly tier: ExtractionTier;
  readonly names: readonly string[];
}

export interface FileRecord {
  readonly nodes: readonly SymbolNode[];
  readonly edges: readonly Edge[];
  readonly tier: ExtractionTier;
  readonly hash: string;
}

export interface AddFileOutcome {
  readonly tier: ExtractionTier;
  /** True when the file's content hash matched the stored record and extraction was skipped. */
  readonly skipped: boolean;
}

export class CodeGraph {
  private readonly files = new Map<string, FileRecord>();

  /** Regex-tier only, synchronous (the original v0.1 entry point — unchanged behavior). */
  addFile(file: string, content: string): void {
    const { nodes, edges } = extractSymbols(file, content);
    this.files.set(file, { nodes, edges, tier: 'regex', hash: hashContent(content) });
  }

  /**
   * Preferred entry point: tries the optional tree-sitter tier and falls back
   * to regex (see `extractSymbolsTiered`), and skips re-extraction entirely
   * when `content` is byte-identical to what's already indexed for `file` —
   * the incremental-indexing lever that keeps a large, persisted graph cheap
   * to keep current across sessions.
   */
  async addFileAuto(file: string, content: string): Promise<AddFileOutcome> {
    const hash = hashContent(content);
    const existing = this.files.get(file);
    if (existing && existing.hash === hash) {
      return { tier: existing.tier, skipped: true };
    }
    const { nodes, edges, tier } = await extractSymbolsTiered(file, content);
    this.files.set(file, { nodes, edges, tier, hash });
    return { tier, skipped: false };
  }

  /** Drop a file from the graph (e.g. it was deleted from disk). */
  removeFile(file: string): boolean {
    return this.files.delete(file);
  }

  allNodes(): SymbolNode[] {
    return [...this.files.values()].flatMap((f) => f.nodes);
  }

  findByName(name: string): SymbolNode[] {
    return this.allNodes().filter((node) => node.name === name);
  }

  /** Per-file symbol name sets + extraction tier, for guard's structural drift-guard tier. */
  fileSymbolSets(): FileSymbolSet[] {
    return [...this.files.entries()].map(([file, record]) => ({
      file,
      tier: record.tier,
      names: record.nodes.map((n) => n.name),
    }));
  }

  /** Same-file symbols plus symbols in files this node's file directly imports. */
  neighbors(node: SymbolNode): SymbolNode[] {
    const fileRecord = this.files.get(node.file);
    const sameFile = (fileRecord?.nodes ?? []).filter((n) => n !== node);
    const importedTargets = (fileRecord?.edges ?? []).map((e) => e.to);
    const importedNodes: SymbolNode[] = [];
    for (const [file, record] of this.files) {
      if (file !== node.file && importedTargets.some((t) => moduleMatchesFile(t, file))) {
        importedNodes.push(...record.nodes);
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

  /** Serialize the whole graph (nodes, edges, tier, content hash per file) for persistence. */
  serialize(): string {
    return JSON.stringify({
      files: [...this.files.entries()].map(([file, r]) => ({ file, ...r })),
    });
  }

  /**
   * Parse a serialized graph. Individual corrupt/unrecognized file entries
   * are skipped (mirrors `TaskLedger.parse`'s per-entry tolerance). A
   * completely invalid JSON string still throws — callers reading from disk
   * (`loadGraphSnapshot`) use that to quarantine the poison-pill file rather
   * than silently discarding it.
   */
  static parse(json: string): CodeGraph {
    const graph = new CodeGraph();
    const data = JSON.parse(json) as { files?: unknown[] };
    for (const raw of data.files ?? []) {
      if (raw === null || typeof raw !== 'object') {
        continue;
      }
      const r = raw as { file?: unknown; nodes?: unknown; edges?: unknown; tier?: unknown; hash?: unknown };
      if (typeof r.file !== 'string' || typeof r.hash !== 'string') {
        continue;
      }
      const tier: ExtractionTier = r.tier === 'treesitter' ? 'treesitter' : 'regex';
      graph.files.set(r.file, {
        nodes: Array.isArray(r.nodes) ? (r.nodes as SymbolNode[]) : [],
        edges: Array.isArray(r.edges) ? (r.edges as Edge[]) : [],
        tier,
        hash: r.hash,
      });
    }
    return graph;
  }
}
