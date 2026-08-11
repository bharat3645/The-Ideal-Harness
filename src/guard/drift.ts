/**
 * Drift-guard — verify that symbols a plan references actually exist, below the
 * LLM. Built on an authority ladder: a source that can only find presence
 * (grep) must never be used to *prove absence*; only a source that can prove
 * absence (tree-sitter/LSP/SCIP) may hard-block. v0.1 ships the grep tier, so
 * it reports missing symbols but does not hard-block on them — the honest
 * behavior, since grep cannot prove a symbol is truly absent.
 */

export type Authority = 'grep' | 'intel' | 'treesitter' | 'lsp' | 'scip';

export const AUTHORITY_ORDER: Readonly<Record<Authority, number>> = {
  grep: 0,
  intel: 1,
  treesitter: 2,
  lsp: 3,
  scip: 4,
};

/** Minimum authority that is allowed to prove absence and thus hard-block. */
export const ABSENCE_PROOF_FLOOR: Authority = 'treesitter';

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface SymbolVerdict {
  readonly symbol: string;
  readonly found: boolean;
  readonly authority: Authority;
  readonly matches: readonly string[];
  /** True only when a sufficiently authoritative source proves the symbol absent. */
  readonly hardBlock: boolean;
}

function definitionRegex(symbol: string): RegExp {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Loose def-site cues across common languages plus any word-boundary mention.
  return new RegExp(
    `(?:function|class|const|let|var|def|interface|type|struct|enum|fn)\\s+${s}\\b|\\b${s}\\s*[=(:]|\\b${s}\\b`,
  );
}

/** Verify one symbol against provided sources at the grep authority tier. */
export function verifySymbol(symbol: string, sources: readonly SourceFile[]): SymbolVerdict {
  const re = definitionRegex(symbol);
  const matches = sources.filter((src) => re.test(src.content)).map((src) => src.path);
  const found = matches.length > 0;
  const authority: Authority = 'grep';
  // grep cannot prove absence, so a not-found at grep tier never hard-blocks.
  const hardBlock = !found && AUTHORITY_ORDER[authority] >= AUTHORITY_ORDER[ABSENCE_PROOF_FLOOR];
  return { symbol, found, authority, matches, hardBlock };
}

/** Verify many symbols; returns per-symbol verdicts. */
export function verifyPlan(symbols: readonly string[], sources: readonly SourceFile[]): SymbolVerdict[] {
  return symbols.map((symbol) => verifySymbol(symbol, sources));
}

/**
 * A file's pre-extracted symbol names plus which tier extracted them.
 * Deliberately independent of `memory`'s own types (guard has no dependency
 * on memory) — `memory`'s `CodeGraph.fileSymbolSets()` produces data shaped
 * to match this at the MCP/caller boundary, not via a shared import.
 */
export interface TieredSourceSymbols {
  readonly path: string;
  readonly names: readonly string[];
  readonly tier: 'treesitter' | 'regex';
}

/**
 * Verify a symbol against PRE-EXTRACTED structural data rather than re-deriving
 * it with a regex over raw content (`verifySymbol`'s approach). This is the
 * tier that can legitimately reach `treesitter` authority and therefore prove
 * absence: absence is provable only when EVERY source considered was
 * extracted at the tree-sitter tier. A single regex-tier fallback anywhere in
 * the set caps the whole verdict at `grep` authority — a source we could not
 * parse might still hide the symbol, so we must not claim to have proven it
 * absent. Same honesty-by-construction rule `verifySymbol` already applies,
 * now actually reachable instead of permanently stuck at the grep floor.
 */
export function verifySymbolStructural(symbol: string, sources: readonly TieredSourceSymbols[]): SymbolVerdict {
  const matches = sources.filter((s) => s.names.includes(symbol)).map((s) => s.path);
  const found = matches.length > 0;
  const allTreeSitter = sources.length > 0 && sources.every((s) => s.tier === 'treesitter');
  const authority: Authority = allTreeSitter ? 'treesitter' : 'grep';
  const hardBlock = !found && AUTHORITY_ORDER[authority] >= AUTHORITY_ORDER[ABSENCE_PROOF_FLOOR];
  return { symbol, found, authority, matches, hardBlock };
}

/** Verify many symbols against pre-extracted structural data; returns per-symbol verdicts. */
export function verifyPlanStructural(
  symbols: readonly string[],
  sources: readonly TieredSourceSymbols[],
): SymbolVerdict[] {
  return symbols.map((symbol) => verifySymbolStructural(symbol, sources));
}
