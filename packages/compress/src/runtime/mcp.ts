/**
 * Compress MCP face. The server holds a single CcrStore for its lifetime so
 * `compress_tool_result` can stash originals that `ccr_retrieve` later pulls back.
 */

import { asString, createMcpServer, HARNESS_VERSION, type McpTool } from '@ideal-harness/core';
import { CcrStore } from '../ccr.js';
import { compressToolResult } from '../detect.js';

export function buildCompressTools(store: CcrStore): McpTool[] {
  return [
    {
      name: 'compress_tool_result',
      description:
        'Deterministically compress a tool result (JSON/log/stack). Cache-safe and idempotent; stashes the original so it stays recoverable via ccr_retrieve.',
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
      },
      handler: (args) => {
        const result = compressToolResult(asString(args, 'content', ''), { store, recoverable: true });
        return { text: JSON.stringify(result) };
      },
    },
    {
      name: 'ccr_retrieve',
      description: 'Retrieve a previously stashed original by its <<ccr:HASH>> marker or hash.',
      inputSchema: {
        type: 'object',
        properties: { marker: { type: 'string' } },
        required: ['marker'],
      },
      handler: (args) => {
        const original = store.retrieve(asString(args, 'marker', ''));
        if (original === undefined) {
          return { text: 'not found (the marker may be from a previous session)', isError: true };
        }
        return { text: original };
      },
    },
  ];
}

export function startCompressMcp(): Promise<void> {
  const store = new CcrStore();
  return createMcpServer({
    name: 'ideal-harness-compress',
    version: HARNESS_VERSION,
    tools: buildCompressTools(store),
  }).listen();
}
