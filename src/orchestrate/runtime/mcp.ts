/**
 * Orchestrate MCP face. Holds a TaskLedger, LoopGuard, and SpendGovernor for
 * the server's lifetime so a controller (in any host) can durably track tasks,
 * detect stalls, and enforce a spend cap. The cap comes from IDEAL_HARNESS_SPEND_CAP.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  asNumber,
  asString,
  createMcpServer,
  HARNESS_VERSION,
  type McpTool,
  type McpToolResult,
} from '../../core/index.js';
import { isTaskStatus, TASK_STATUSES, TaskLedger } from '../ledger.js';
import { LoopGuard } from '../loopguard.js';
import { SpendGovernor } from '../spend.js';

/** Result of a persist attempt — lets handlers surface durability failures. */
export interface PersistResult {
  readonly ok: boolean;
  readonly error?: string;
}

export function buildOrchestrateTools(
  ledger: TaskLedger,
  loop: LoopGuard,
  spend: SpendGovernor,
  /** Persist callback invoked after every ledger mutation (no-op success by default). */
  persist: () => PersistResult = () => ({ ok: true }),
): McpTool[] {
  // A mutation result must report whether it actually reached durable storage —
  // returning success when the write failed would be silent data loss.
  const withPersist = (value: unknown): McpToolResult => {
    const p = persist();
    if (p.ok) {
      return { text: JSON.stringify(value) };
    }
    return {
      text: JSON.stringify({ ...(value as object), persisted: false, warning: `not persisted: ${p.error}` }),
      isError: true,
    };
  };
  return [
    {
      name: 'ledger_add',
      description: 'Add a task to the durable ledger. Returns the created task.',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      handler: (args) => withPersist(ledger.add(asString(args, 'title', ''))),
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
          // Reject an unknown status at the boundary. Without this, an invalid
          // status (e.g. "blocked") would make the task invisible to nextPending()
          // and stick forever until a checkpoint reload repaired it.
          if (!isTaskStatus(args.status)) {
            return {
              text: JSON.stringify({ error: `invalid status: ${asString(args, 'status')}`, valid: TASK_STATUSES }),
              isError: true,
            };
          }
          patch.status = args.status;
        }
        if (args.artifact !== undefined) {
          patch.artifact = asString(args, 'artifact');
        }
        if (args.notes !== undefined) {
          patch.notes = asString(args, 'notes');
        }
        return withPersist(ledger.update(asString(args, 'id'), patch));
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
      handler: (args) => ({ text: JSON.stringify(loop.record(asString(args, 'signature', ''))) }),
    },
    {
      name: 'spend_check',
      description: 'Gate a prospective token spend against the cap, and record it if allowed.',
      inputSchema: { type: 'object', properties: { tokens: { type: 'number' } }, required: ['tokens'] },
      handler: (args) => {
        const tokens = asNumber(args, 'tokens', 0);
        // Validate before touching the governor: a non-numeric "tokens" (e.g. "abc")
        // coerces to NaN, which would poison the spend total and disable the cap.
        if (!Number.isFinite(tokens) || tokens < 0) {
          return {
            text: JSON.stringify({ allowed: false, reason: `invalid token count: ${asString(args, 'tokens')}` }),
            isError: true,
          };
        }
        const decision = spend.check(tokens);
        if (decision.allowed) {
          spend.record(tokens);
        }
        return { text: JSON.stringify({ ...decision, spent: spend.spent(), remaining: spend.remaining() }) };
      },
    },
  ];
}

/** Resolve the spend cap from the env, ignoring (with a loud warning) invalid values. */
function resolveSpendCap(): number | null {
  const capRaw = process.env.IDEAL_HARNESS_SPEND_CAP;
  if (capRaw === undefined || capRaw.length === 0) {
    return null;
  }
  const n = Number(capRaw);
  if (!Number.isFinite(n) || n < 0) {
    // Never silently disable the cap on a typo — warn and fall back to unmetered.
    process.stderr.write(
      `ideal-harness-orchestrate: ignoring invalid IDEAL_HARNESS_SPEND_CAP="${capRaw}" (using no cap)\n`,
    );
    return null;
  }
  return n;
}

export function startOrchestrateMcp(): Promise<void> {
  // File-backed ledger so a controller's progress survives an MCP server restart,
  // not just context compaction. Lives under the gitignored .ideal-harness/ dir.
  const ledgerPath =
    process.env.IDEAL_HARNESS_LEDGER ?? join(process.cwd(), '.ideal-harness', 'orchestrate-ledger.json');
  let ledger = new TaskLedger();
  try {
    if (existsSync(ledgerPath)) {
      ledger = TaskLedger.parse(readFileSync(ledgerPath, 'utf8'));
    }
  } catch (error) {
    // Quarantine an unreadable ledger so we don't hit the same poison pill on
    // every restart, but preserve it (renamed) for debugging instead of deleting.
    const corruptPath = `${ledgerPath}.corrupt`;
    try {
      renameSync(ledgerPath, corruptPath);
      process.stderr.write(
        `ideal-harness-orchestrate: could not load ledger (${String(error)}); moved corrupt file to ${corruptPath}, starting fresh\n`,
      );
    } catch {
      process.stderr.write(
        `ideal-harness-orchestrate: could not load or quarantine ledger (${String(error)}); starting fresh\n`,
      );
    }
  }
  const persist = (): PersistResult => {
    try {
      mkdirSync(dirname(ledgerPath), { recursive: true });
      // Atomic write: serialize to a temp file then rename over the target, so a
      // crash mid-write can never leave a torn/half-written (corrupt) ledger.
      const tmp = `${ledgerPath}.tmp`;
      writeFileSync(tmp, ledger.serialize());
      renameSync(tmp, ledgerPath);
      return { ok: true };
    } catch (error) {
      process.stderr.write(`ideal-harness-orchestrate: could not persist ledger (${String(error)})\n`);
      return { ok: false, error: String(error) };
    }
  };
  process.stderr.write(`ideal-harness-orchestrate: ledger ${ledgerPath} (${ledger.all().length} task(s) loaded)\n`);

  const tools = buildOrchestrateTools(ledger, new LoopGuard(), new SpendGovernor(resolveSpendCap()), persist);
  return createMcpServer({ name: 'ideal-harness-orchestrate', version: HARNESS_VERSION, tools }).listen();
}
