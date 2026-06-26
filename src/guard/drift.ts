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
