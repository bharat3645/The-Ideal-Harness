/**
 * @ideal-harness/memory — structural + episodic memory.
 *
 * A dependency-free code-graph with token-budgeted subgraph retrieval (recall
 * structure, not whole files) and an episodic store ranked by real BM25
 * relevance, kept honest by a curator that reconciles claims against tool-call
 * evidence. Structural and episodic memory are complementary layers.
 */

export {
  type ExportOptions as VaultExportOptions,
  type ExportResult as VaultExportResult,
  exportToVault,
  type ImportCandidate as VaultImportCandidate,
  type ImportOptions as VaultImportOptions,
  type ImportResult as VaultImportResult,
  importFromVault,
} from './bridge/obsidian.js';
export { type ReconciledClaim, reconcileClaims, type ToolCallEvidence } from './curator.js';
export { type Bm25Doc, Bm25Index, type ScoredDoc, tokenize } from './episodic/bm25.js';
export { type ConsolidateOptions, type ConsolidateResult, consolidate } from './episodic/consolidate.js';
export { episodicSnapshotPath, loadEpisodicSnapshot, saveEpisodicSnapshot } from './episodic/persist.js';
export { type SearchHit, type SearchOptions, searchObservations } from './episodic/search.js';
export {
  EpisodicStore,
  filterByWorkspace,
  type Observation,
  type ObservationType,
  parseObservations,
} from './episodic/store.js';
export { type Confidence, type Edge, extractSymbols, type SymbolKind, type SymbolNode } from './structural/extract.js';
export {
  type AddFileOutcome,
  CodeGraph,
  type FileSymbolSet,
  type SubgraphResult,
} from './structural/graph.js';
export { graphSnapshotPath, loadGraphSnapshot, saveGraphSnapshot } from './structural/persist.js';
export {
  type ExtractionTier,
  extractSymbolsTiered,
  languageForFile,
  type TieredExtraction,
  treeSitterAvailable,
} from './structural/treesitter.js';
export {
  bindWorkspace,
  deriveWorkspaceKey,
  EPHEMERAL_WORKSPACE,
  findWorkspaceRoot,
  normalizeGitRemote,
  resolveWorkspace,
  type Workspace,
} from './workspace.js';
