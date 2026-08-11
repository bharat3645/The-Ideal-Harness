/**
 * Memory MCP face. The server holds a CodeGraph + EpisodicStore for its
 * lifetime so files indexed via `add_file` are queryable via `query_graph`, and
 * observations written via `memory_write` are recalled via `memory_search`.
 */

import { asNumber, asString, createMcpServer, HARNESS_VERSION, type McpTool } from '../../core/index.js';
import { redactSecrets, wrapUntrusted } from '../../guard/index.js';
import { reconcileClaims, type ToolCallEvidence } from '../curator.js';
import { consolidate } from '../episodic/consolidate.js';
import { loadEpisodicSnapshot, saveEpisodicSnapshot } from '../episodic/persist.js';
import { searchObservations } from '../episodic/search.js';
import { EpisodicStore, type ObservationType } from '../episodic/store.js';
import { CodeGraph } from '../structural/graph.js';
import { loadGraphSnapshot, saveGraphSnapshot } from '../structural/persist.js';
import { resolveWorkspace } from '../workspace.js';

export function buildMemoryTools(
  graph: CodeGraph,
  store: EpisodicStore,
  /** Persist callback invoked after every graph mutation (no-op success by default, for pure tests). */
  persistGraph: () => boolean = () => true,
  /** Persist callback invoked after every episodic mutation (no-op success by default, for pure tests). */
  persistEpisodic: () => boolean = () => true,
): McpTool[] {
  return [
    {
      name: 'add_file',
      description: 'Index a source file into the code graph (tree-sitter tier when available, else regex).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      handler: async (args) => {
        const path = asString(args, 'path');
        const outcome = await graph.addFileAuto(path, asString(args, 'content', ''));
        const persisted = outcome.skipped ? true : persistGraph();
        return {
          text: JSON.stringify({ indexed: path, nodes: graph.allNodes().length, ...outcome, persisted }),
          ...(persisted ? {} : { isError: true }),
        };
      },
    },
    {
      name: 'query_graph',
      description: 'Retrieve a token-budgeted structural subgraph relevant to a query (symbols + file:line).',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, tokenBudget: { type: 'number' } },
        required: ['query'],
      },
      handler: (args) => {
        const result = graph.querySubgraph(asString(args, 'query', ''), asNumber(args, 'tokenBudget', 2000));
        return { text: result.text };
      },
    },
    {
      name: 'memory_write',
      description:
        'Write an episodic observation (bugfix/feature/decision/security_alert/failure/note). ' +
        'Pass `evidence` (the output of `reconcile` for this claim) to stamp provenance on the record.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          text: { type: 'string' },
          ts: { type: 'number' },
          evidence: {
            type: 'object',
            properties: { overlap: { type: 'number' }, matchedTool: { type: 'string' } },
          },
        },
        required: ['type', 'text', 'ts'],
      },
      handler: (args) => {
        // Redact secrets BEFORE they are persisted. A secret in long-term memory
        // that auto-injects into future sessions is the exact nightmare we refuse
        // to create — mask it at the write boundary, below the model.
        const { text: safe, count } = redactSecrets(asString(args, 'text', ''));
        const evidence = args.evidence as { overlap?: number; matchedTool?: string } | undefined;
        const record = store.add({
          type: asString(args, 'type') as ObservationType,
          text: safe,
          ts: asNumber(args, 'ts'),
          ...(evidence && typeof evidence.overlap === 'number'
            ? {
                evidence: {
                  overlap: evidence.overlap,
                  ...(evidence.matchedTool ? { matchedTool: evidence.matchedTool } : {}),
                },
              }
            : {}),
        });
        const persisted = persistEpisodic();
        return {
          text: JSON.stringify({ ...record, redactedSecrets: count, persisted }),
          ...(persisted ? {} : { isError: true }),
        };
      },
    },
    {
      name: 'memory_consolidate',
      description: 'Dedupe near-identical observations and prune low-signal ones once the store grows large.',
      inputSchema: {
        type: 'object',
        properties: { maxCount: { type: 'number' } },
      },
      handler: (args) => {
        const before = store.all().length;
        const result = consolidate(store.all(), { maxCount: asNumber(args, 'maxCount', 2000) });
        store.replaceAll(result.kept);
        const persisted = persistEpisodic();
        return {
          text: JSON.stringify({
            before,
            after: result.kept.length,
            deduped: result.dedupedCount,
            pruned: result.prunedCount,
            persisted,
          }),
          ...(persisted ? {} : { isError: true }),
        };
      },
    },
    {
      name: 'memory_search',
      description: 'Recall episodic observations by BM25 relevance (not recency).',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
      handler: (args) => {
        const hits = searchObservations(store.all(), asString(args, 'query', ''), {
          limit: asNumber(args, 'limit', 10),
        });
        // Recalled memory is untrusted: it may carry instructions written in a
        // past session. Fence it so the model treats it as data, not commands.
        return { text: wrapUntrusted(JSON.stringify(hits), { source: 'memory' }) };
      },
    },
    {
      name: 'reconcile',
      description: 'Reconcile claimed work against tool-call evidence; returns which claims are corroborated.',
      inputSchema: {
        type: 'object',
        properties: {
          claims: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: { type: 'object' } },
        },
        required: ['claims', 'evidence'],
      },
      handler: (args) => {
        const claims = (args.claims as string[]) ?? [];
        const evidence = (args.evidence as ToolCallEvidence[]) ?? [];
        return { text: JSON.stringify(reconcileClaims(claims, evidence)) };
      },
    },
  ];
}

export function startMemoryMcp(): Promise<void> {
  // Bind to exactly one workspace for the server's whole life. No tool can target
  // another project, so a confused or injected model cannot reach another repo's
  // memory. Unresolved workspace → ephemeral (fail-closed), never a shared store.
  const ws = resolveWorkspace();
  // Persistent workspaces resume from their last indexed snapshot instead of
  // cold-indexing from zero every session — the actual "any size codebase"
  // lever: paid once, not every session, and addFileAuto only re-extracts
  // what actually changed since the snapshot was written.
  const graph = ws.persistent && ws.storeDir ? loadGraphSnapshot(ws.storeDir) : new CodeGraph();
  const store = ws.persistent && ws.storeDir ? loadEpisodicSnapshot(ws.storeDir, ws.key) : new EpisodicStore(ws.key);
  process.stderr.write(
    `ideal-harness-memory: workspace ${ws.key}${
      ws.persistent
        ? ` (store: ${ws.storeDir}, ${graph.allNodes().length} node(s), ${store.all().length} observation(s) resumed)`
        : ' (ephemeral — not persisted)'
    }\n`,
  );
  const persistGraph = (): boolean => {
    if (!ws.persistent || !ws.storeDir) {
      return true; // ephemeral workspace: nothing to persist, not a failure
    }
    const ok = saveGraphSnapshot(graph, ws.storeDir);
    if (!ok) {
      process.stderr.write('ideal-harness-memory: could not persist graph snapshot\n');
    }
    return ok;
  };
  const persistEpisodic = (): boolean => {
    if (!ws.persistent || !ws.storeDir) {
      return true; // ephemeral workspace: nothing to persist, not a failure
    }
    const ok = saveEpisodicSnapshot(store, ws.storeDir);
    if (!ok) {
      process.stderr.write('ideal-harness-memory: could not persist episodic snapshot\n');
    }
    return ok;
  };
  return createMcpServer({
    name: 'ideal-harness-memory',
    version: HARNESS_VERSION,
    tools: buildMemoryTools(graph, store, persistGraph, persistEpisodic),
  }).listen();
}
