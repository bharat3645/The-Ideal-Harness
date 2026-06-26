/**
 * Memory MCP face. The server holds a CodeGraph + EpisodicStore for its
 * lifetime so files indexed via `add_file` are queryable via `query_graph`, and
 * observations written via `memory_write` are recalled via `memory_search`.
 */

import { asNumber, asString, createMcpServer, HARNESS_VERSION, type McpTool } from '../../core/index.js';
import { redactSecrets, wrapUntrusted } from '../../guard/index.js';
import { reconcileClaims, type ToolCallEvidence } from '../curator.js';
import { searchObservations } from '../episodic/search.js';
import { EpisodicStore, type ObservationType } from '../episodic/store.js';
import { CodeGraph } from '../structural/graph.js';
import { resolveWorkspace } from '../workspace.js';

export function buildMemoryTools(graph: CodeGraph, store: EpisodicStore): McpTool[] {
  return [
    {
      name: 'add_file',
      description: 'Index a source file into the code graph.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      handler: (args) => {
        const path = asString(args, 'path');
        graph.addFile(path, asString(args, 'content', ''));
        return { text: JSON.stringify({ indexed: path, nodes: graph.allNodes().length }) };
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
      description: 'Write an episodic observation (bugfix/feature/decision/security_alert/note).',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          text: { type: 'string' },
          ts: { type: 'number' },
        },
        required: ['type', 'text', 'ts'],
      },
      handler: (args) => {
        // Redact secrets BEFORE they are persisted. A secret in long-term memory
        // that auto-injects into future sessions is the exact nightmare we refuse
        // to create — mask it at the write boundary, below the model.
        const { text: safe, count } = redactSecrets(asString(args, 'text', ''));
        const record = store.add({
          type: asString(args, 'type') as ObservationType,
          text: safe,
          ts: asNumber(args, 'ts'),
        });
        return { text: JSON.stringify({ ...record, redactedSecrets: count }) };
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
  process.stderr.write(
    `ideal-harness-memory: workspace ${ws.key}${
      ws.persistent ? ` (store: ${ws.storeDir})` : ' (ephemeral — not persisted)'
    }\n`,
  );
  const graph = new CodeGraph();
  const store = new EpisodicStore(ws.key);
  return createMcpServer({
    name: 'ideal-harness-memory',
    version: HARNESS_VERSION,
    tools: buildMemoryTools(graph, store),
  }).listen();
}
