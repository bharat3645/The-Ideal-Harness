/**
 * Guard's MCP face — exposes the enforcement primitives as MCP tools so any
 * MCP-capable host (not just Claude Code) can call them (Tier-2 portability).
 */

import { asString, createMcpServer, HARNESS_VERSION, type McpTool } from '../../core/index.js';
import { type SourceFile, verifyPlan } from '../drift.js';
import { DEFAULT_RULES } from '../policy/defaults.js';
import { evaluate } from '../policy/engine.js';
import type { ToolRequest } from '../policy/types.js';
import { redactSecrets } from '../redact.js';
import { scanSkill } from '../vet/scan.js';

export function buildGuardTools(): McpTool[] {
  return [
    {
      name: 'policy_check',
      description: 'Evaluate a tool-use request against the deny-wins policy. Returns allow/ask/deny + reason.',
      inputSchema: {
        type: 'object',
        properties: {
          tool: { type: 'string' },
          input: { type: 'object' },
        },
        required: ['tool'],
      },
      handler: (args) => {
        const request: ToolRequest = {
          tool: asString(args, 'tool'),
          input: (args.input as Record<string, unknown>) ?? {},
        };
        return { text: JSON.stringify(evaluate(request, DEFAULT_RULES)) };
      },
    },
    {
      name: 'vet_skill',
      description: 'Scan skill text (SKILL.md or bundled script) for threats + hidden characters before loading it.',
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
      },
      handler: (args) => {
        const result = scanSkill(asString(args, 'content', ''));
        return { text: JSON.stringify(result), isError: !result.ok };
      },
    },
    {
      name: 'verify_symbol',
      description: 'Verify (grep tier) that referenced symbols exist in the provided sources. Reports missing symbols.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: { type: 'array', items: { type: 'string' } },
          sources: {
            type: 'array',
            items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
          },
        },
        required: ['symbols', 'sources'],
      },
      handler: (args) => {
        const symbols = (args.symbols as string[]) ?? [];
        const sources = (args.sources as SourceFile[]) ?? [];
        return { text: JSON.stringify(verifyPlan(symbols, sources)) };
      },
    },
    {
      name: 'redact',
      description: 'Redact secrets from text. Returns redacted text + counts.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      handler: (args) => ({ text: JSON.stringify(redactSecrets(asString(args, 'text', ''))) }),
    },
  ];
}

export function startGuardMcp(): Promise<void> {
  return createMcpServer({ name: 'ideal-harness-guard', version: HARNESS_VERSION, tools: buildGuardTools() }).listen();
}
