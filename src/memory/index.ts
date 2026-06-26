/**
 * @ideal-harness/memory — structural + episodic memory.
 *
 * A dependency-free code-graph with token-budgeted subgraph retrieval (recall
 * structure, not whole files) and an episodic store ranked by real BM25
 * relevance, kept honest by a curator that reconciles claims against tool-call
 * evidence. Structural and episodic memory are complementary layers.
 */

export { type ReconciledClaim, reconcileClaims, type ToolCallEvidence } from './curator.js';
export { type Bm25Doc, Bm25Index, type ScoredDoc, tokenize } from './episodic/bm25.js';
export { type SearchHit, type SearchOptions, searchObservations } from './episodic/search.js';
export {
  EpisodicStore,
  filterByWorkspace,
  type Observation,
  type ObservationType,
  parseObservations,
} from './episodic/store.js';
export { type Confidence, type Edge, extractSymbols, type SymbolKind, type SymbolNode } from './structural/extract.js';
export { CodeGraph, type SubgraphResult } from './structural/graph.js';
export {
  bindWorkspace,
  deriveWorkspaceKey,
  EPHEMERAL_WORKSPACE,
  findWorkspaceRoot,
  normalizeGitRemote,
  resolveWorkspace,
  type Workspace,
} from './workspace.js';
