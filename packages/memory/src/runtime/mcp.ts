/**
 * Memory MCP face. The server holds a CodeGraph + EpisodicStore for its
 * lifetime so files indexed via `add_file` are queryable via `query_graph`, and
 * observations written via `memory_write` are recalled via `memory_search`.
 */

import { createMcpServer, type McpTool } from '@ideal-harness/core';
import { reconcileClaims, type ToolCallEvidence } from '../curator.js';
import { searchObservations } from '../episodic/search.js';
import { EpisodicStore, type ObservationType } from '../episodic/store.js';
import { CodeGraph } from '../structural/graph.js';

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
        graph.addFile(String(args.path), String(args.content ?? ''));
        return { text: JSON.stringify({ indexed: String(args.path), nodes: graph.allNodes().length }) };
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
        const result = graph.querySubgraph(String(args.query ?? ''), Number(args.tokenBudget ?? 2000));
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
        const record = store.add({
          type: String(args.type) as ObservationType,
          text: String(args.text ?? ''),
          ts: Number(args.ts),
        });
        return { text: JSON.stringify(record) };
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
        const hits = searchObservations(store.all(), String(args.query ?? ''), { limit: Number(args.limit ?? 10) });
        return { text: JSON.stringify(hits) };
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
  const graph = new CodeGraph();
  const store = new EpisodicStore();
  return createMcpServer({
    name: 'ideal-harness-memory',
    version: '0.1.0',
    tools: buildMemoryTools(graph, store),
  }).listen();
}
