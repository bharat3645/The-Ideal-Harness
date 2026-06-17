/**
 * Orchestrate MCP face. Holds a TaskLedger, LoopGuard, and SpendGovernor for
 * the server's lifetime so a controller (in any host) can durably track tasks,
 * detect stalls, and enforce a spend cap. The cap comes from IDEAL_HARNESS_SPEND_CAP.
 */

import { createMcpServer, type McpTool } from '@ideal-harness/core';
import { TaskLedger, type TaskStatus } from '../ledger.js';
import { LoopGuard } from '../loopguard.js';
import { SpendGovernor } from '../spend.js';

export function buildOrchestrateTools(ledger: TaskLedger, loop: LoopGuard, spend: SpendGovernor): McpTool[] {
  return [
    {
      name: 'ledger_add',
      description: 'Add a task to the durable ledger. Returns the created task.',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      handler: (args) => ({ text: JSON.stringify(ledger.add(String(args.title ?? ''))) }),
    },
    {
      name: 'ledger_update',
      description: 'Update a ledger task status/artifact/notes.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          artifact: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
      handler: (args) => {
        const patch: Record<string, unknown> = {};
        if (args.status !== undefined) {
          patch.status = String(args.status) as TaskStatus;
        }
        if (args.artifact !== undefined) {
          patch.artifact = String(args.artifact);
        }
        if (args.notes !== undefined) {
          patch.notes = String(args.notes);
        }
        return { text: JSON.stringify(ledger.update(String(args.id), patch)) };
      },
    },
    {
      name: 'ledger_status',
      description: 'Get ledger progress, all tasks, and the next pending task.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({
        text: JSON.stringify({ progress: ledger.progress(), next: ledger.nextPending() ?? null, tasks: ledger.all() }),
      }),
    },
    {
      name: 'loop_check',
      description: 'Record an action signature; returns whether the agent appears stalled (looping).',
      inputSchema: { type: 'object', properties: { signature: { type: 'string' } }, required: ['signature'] },
      handler: (args) => ({ text: JSON.stringify(loop.record(String(args.signature ?? ''))) }),
    },
    {
      name: 'spend_check',
      description: 'Gate a prospective token spend against the cap, and record it if allowed.',
      inputSchema: { type: 'object', properties: { tokens: { type: 'number' } }, required: ['tokens'] },
      handler: (args) => {
        const tokens = Number(args.tokens ?? 0);
        const decision = spend.check(tokens);
        if (decision.allowed) {
          spend.record(tokens);
        }
        return { text: JSON.stringify({ ...decision, spent: spend.spent(), remaining: spend.remaining() }) };
      },
    },
  ];
}

export function startOrchestrateMcp(): Promise<void> {
  const capRaw = process.env.IDEAL_HARNESS_SPEND_CAP;
  const cap = capRaw !== undefined && capRaw.length > 0 ? Number(capRaw) : null;
  const tools = buildOrchestrateTools(new TaskLedger(), new LoopGuard(), new SpendGovernor(cap));
  return createMcpServer({ name: 'ideal-harness-orchestrate', version: '0.1.0', tools }).listen();
}
