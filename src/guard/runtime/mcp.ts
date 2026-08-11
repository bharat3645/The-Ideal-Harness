/**
 * Guard's MCP face — exposes the enforcement primitives as MCP tools so any
 * MCP-capable host (not just Claude Code) can call them (Tier-2 portability).
 */

import { asString, createMcpServer, HARNESS_VERSION, type McpTool } from '../../core/index.js';
import { applyFloorMode, floorMode } from '../bypass.js';
import { type SourceFile, type TieredSourceSymbols, verifyPlan, verifyPlanStructural } from '../drift.js';
import { evaluateTiered } from '../policy/engine.js';
import type { ToolRequest } from '../policy/types.js';
import { redactSecrets } from '../redact.js';
import { resolveOperatorTiers } from '../resolve.js';
import { scanSkillDir } from '../vet/external.js';
import { scanSkill } from '../vet/scan.js';

export function buildGuardTools(): McpTool[] {
  return [
    {
      name: 'policy_check',
      description:
        'Evaluate a tool-use request the SAME way the interactive PreToolUse hook would: the full operator ' +
        'tier stack (leases, personal + team policy, defaults) and the active floor mode (soft/enforce/bypass). ' +
        'Returns allow/ask/deny + reason. The Tier-2 embedding entry point — call this before acting on a tool ' +
        'request in your own host/product, the way the hook does automatically on Claude Code. Does NOT journal ' +
        'the decision (this is a check, not an action) — journal at your own actual point of action.',
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
        const { tiers } = resolveOperatorTiers();
        const decision = evaluateTiered(request, tiers);
        return { text: JSON.stringify(applyFloorMode(decision, floorMode())) };
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
      name: 'vet_skill_deep',
      description:
        'Deeper vetting for a skill DIRECTORY before install: the regex + hidden-char scan over every file, ' +
        'plus semgrep (offline -- bundled ruleset, never the hosted registry, no network) and osv-scanner ' +
        '(live network to osv.dev) when present on PATH. Both external shell-outs are policy-gated as a Bash ' +
        'call against the full operator tier stack (leases, personal + team policy, defaults) with NO floor-mode ' +
        'softening -- there is no human to answer an ask here, same safety property as ledger_verify. Unlike ' +
        'vet_skill (text-only, always available), an absent tool degrades to "skipped" and is reported in ' +
        'externalTools, never a hard failure of the vet.',
      inputSchema: {
        type: 'object',
        properties: { dir: { type: 'string' } },
        required: ['dir'],
      },
      handler: async (args) => {
        const { tiers } = resolveOperatorTiers();
        const result = await scanSkillDir(asString(args, 'dir'), { policyTiers: tiers });
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
      name: 'verify_symbol_structural',
      description:
        "Verify referenced symbols against PRE-EXTRACTED structural data (e.g. from memory's query_graph / " +
        'fileSymbolSets, tagged with their extraction tier). Can hard-block a hallucinated symbol -- but only ' +
        'when every source considered was parsed at the tree-sitter tier; any regex-tier fallback caps the ' +
        'verdict at grep authority, which never hard-blocks.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: { type: 'array', items: { type: 'string' } },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                names: { type: 'array', items: { type: 'string' } },
                tier: { type: 'string', enum: ['treesitter', 'regex'] },
              },
            },
          },
        },
        required: ['symbols', 'sources'],
      },
      handler: (args) => {
        const symbols = (args.symbols as string[]) ?? [];
        const sources = (args.sources as TieredSourceSymbols[]) ?? [];
        return { text: JSON.stringify(verifyPlanStructural(symbols, sources)) };
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
