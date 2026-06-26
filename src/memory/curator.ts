/**
 * Curator — reconcile LLM claims against tool-call evidence.
 *
 * Before a model's self-reported "what I did" is committed to memory, check it
 * against what actually happened (the tool-call log). A claim is kept only if
 * its significant terms are corroborated by some tool call. Deterministic-first:
 * we trust evidence over prose.
 */

import { tokenize } from './episodic/bm25.js';

export interface ToolCallEvidence {
  readonly tool: string;
  readonly summary: string;
}

export interface ReconciledClaim {
  readonly claim: string;
  readonly evidenced: boolean;
  readonly overlap: number;
  readonly matchedTool?: string;
}

const DEFAULT_THRESHOLD = 0.5;

export function reconcileClaims(
  claims: readonly string[],
  evidence: readonly ToolCallEvidence[],
  threshold = DEFAULT_THRESHOLD,
): ReconciledClaim[] {
  const evidenceTokens = evidence.map((e) => ({ tool: e.tool, tokens: new Set(tokenize(e.summary)) }));

  return claims.map((claim) => {
    const claimTerms = [...new Set(tokenize(claim))];
    if (claimTerms.length === 0) {
      return { claim, evidenced: false, overlap: 0 };
    }
    let best = 0;
    let matchedTool: string | undefined;
    for (const ev of evidenceTokens) {
      const hits = claimTerms.filter((term) => ev.tokens.has(term)).length;
      const overlap = hits / claimTerms.length;
      if (overlap > best) {
        best = overlap;
        matchedTool = ev.tool;
      }
    }
    const evidenced = best >= threshold;
    return {
      claim,
      evidenced,
      overlap: Number(best.toFixed(3)),
      ...(evidenced && matchedTool !== undefined ? { matchedTool } : {}),
    };
  });
}
