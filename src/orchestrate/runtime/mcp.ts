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
  lockPathFor,
  type McpTool,
  type McpToolResult,
  withFileLock,
} from '../../core/index.js';
import { consumeLeaseIfDecided, resolveOperatorTiers } from '../../guard/index.js';
import { isTaskStatus, isTaskVerify, TASK_STATUSES, TaskLedger, type TaskVerify } from '../ledger.js';
import { LoopGuard } from '../loopguard.js';
import { parseSpendState, SpendGovernor, serializeSpendState } from '../spend.js';
import { runVerify } from '../verify.js';
import { createWorktree, listWorktrees, removeWorktree } from '../worktree.js';

/** Result of a persist attempt — lets handlers surface durability failures. */
export interface PersistResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Lock-protected ledger I/O (issue #17 / `decisions.md` D039). When provided
 * to `buildOrchestrateTools`, every mutating tool reloads the freshest
 * on-disk ledger under an exclusive lock, applies its mutation to THAT
 * (not the long-held in-memory `ledger`), saves it, and resyncs `ledger` in
 * place — closing the lost-update race where two concurrent processes each
 * hold a stale in-memory copy and the second writer silently clobbers the
 * first's change. Omitted (the default), behavior is byte-for-byte what it
 * was before #17: mutate `ledger` in memory, call `persist()`.
 */
export interface LedgerIo {
  readonly load: () => TaskLedger;
  readonly save: (ledger: TaskLedger) => PersistResult;
  readonly lockPath: string;
}

/** Same pattern as `LedgerIo`, for the spend checkpoint — see issue #17 / D039. */
export interface SpendIo {
  readonly load: () => number;
  readonly save: (used: number) => void;
  readonly lockPath: string;
}

export function buildOrchestrateTools(
  ledger: TaskLedger,
  loop: LoopGuard,
  spend: SpendGovernor,
  /** Persist callback invoked after every ledger mutation (no-op success by default). Ignored when `ledgerIo` is provided. */
  persist: () => PersistResult = () => ({ ok: true }),
  /** Persist callback invoked after every recorded spend (no-op by default). See issue #14. Ignored when `spendIo` is provided. */
  persistSpend: () => void = () => {},
  /** See `LedgerIo`'s docs. Undefined preserves pre-#17 in-memory-only behavior (what every pure unit test uses). */
  ledgerIo?: LedgerIo,
  /** See `SpendIo`'s docs. Undefined preserves pre-#17 in-memory-only behavior. */
  spendIo?: SpendIo,
): McpTool[] {
  // A mutation result must report whether it actually reached durable storage —
  // returning success when the write failed would be silent data loss.
  const shapeResult = (value: unknown, persisted: PersistResult): McpToolResult => {
    if (persisted.ok) {
      return { text: JSON.stringify(value) };
    }
    return {
      text: JSON.stringify({ ...(value as object), persisted: false, warning: `not persisted: ${persisted.error}` }),
      isError: true,
    };
  };
  /**
   * Apply `mutate` to the freshest known ledger state and report whether it
   * durably persisted. With `ledgerIo`: locks, reloads fresh from disk,
   * mutates THAT, saves, and resyncs `ledger` so every other handler sees
   * the merged result too — see `LedgerIo`'s docs. Without it: mutates
   * `ledger` directly and reports via `persist()`, unchanged from pre-#17
   * behavior.
   */
  const mutateLedger = async <T>(
    mutate: (target: TaskLedger) => T,
  ): Promise<{ result: T; persisted: PersistResult }> => {
    if (ledgerIo === undefined) {
      return { result: mutate(ledger), persisted: persist() };
    }
    try {
      return await withFileLock(ledgerIo.lockPath, () => {
        const fresh = ledgerIo.load();
        const result = mutate(fresh);
        const persisted = ledgerIo.save(fresh);
        ledger.loadFrom(fresh);
        return { result, persisted };
      });
    } catch (error) {
      // Lock acquisition itself failed (another process genuinely holds it past
      // the bounded wait) — a real, actionable failure, not silent data loss:
      // the caller's mutation never happened at all, so nothing was lost.
      throw new Error(`ledger locked: ${String(error)}`);
    }
  };

  return [
    {
      name: 'ledger_add',
      description:
        'Add a task to the durable ledger, optionally with a verify {command, expect?} so "done" is a ' +
        'measurement, not an assertion. Returns the created task.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          verify: {
            type: 'object',
            properties: { command: { type: 'string' }, expect: { type: 'string' } },
            required: ['command'],
          },
        },
        required: ['title'],
      },
      handler: async (args) => {
        if (args.verify !== undefined && !isTaskVerify(args.verify)) {
          return {
            text: JSON.stringify({ error: 'invalid verify: expected {command: string, expect?: string}' }),
            isError: true,
          };
        }
        const title = asString(args, 'title', '');
        const verify = args.verify as TaskVerify | undefined;
        try {
          const { result, persisted } = await mutateLedger((target) => target.add(title, undefined, verify));
          return shapeResult(result, persisted);
        } catch (error) {
          return { text: JSON.stringify({ error: String(error) }), isError: true };
        }
      },
    },
    {
      name: 'ledger_update',
      description: 'Update a ledger task status/artifact/notes/verify.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          artifact: { type: 'string' },
          notes: { type: 'string' },
          verify: {
            type: 'object',
            properties: { command: { type: 'string' }, expect: { type: 'string' } },
            required: ['command'],
          },
        },
        required: ['id'],
      },
      handler: async (args) => {
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
        if (args.verify !== undefined) {
          if (!isTaskVerify(args.verify)) {
            return {
              text: JSON.stringify({ error: 'invalid verify: expected {command: string, expect?: string}' }),
              isError: true,
            };
          }
          patch.verify = args.verify;
        }
        const id = asString(args, 'id');
        try {
          const { result, persisted } = await mutateLedger((target) => target.update(id, patch));
          return shapeResult(result, persisted);
        } catch (error) {
          return { text: JSON.stringify({ error: String(error) }), isError: true };
        }
      },
    },
    {
      name: 'ledger_verify',
      description:
        "Actually run a task's verify.command (policy-gated to an unsoftened allow, sandboxed when the " +
        "platform supports it) and set status to done/failed from the REAL result, not the agent's self-report. " +
        'Refuses to run (status untouched) when the policy decision is not an explicit allow.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      handler: async (args) => {
        const id = asString(args, 'id');
        const task = ledger.get(id);
        if (task === undefined) {
          return { text: JSON.stringify({ error: `no ledger task with id "${id}"` }), isError: true };
        }
        if (task.verify === undefined) {
          return { text: JSON.stringify({ error: `task "${id}" has no verify.command set` }), isError: true };
        }
        // Resolve the SAME operator-configured tier stack (leases, personal
        // and team policy, then defaults) the interactive PreToolUse hook
        // uses — without this, ledger_verify would only ever see the bare
        // default floor (which asks for arbitrary Bash) and could never be
        // enabled no matter how the operator configures policy.
        const { tiers } = resolveOperatorTiers();
        const result = await runVerify(task.verify, { policyTiers: tiers });
        consumeLeaseIfDecided(result.decision);
        if (!result.ran) {
          return {
            text: JSON.stringify({
              task,
              result,
              note: `blocked: policy decision was "${result.decision.action}" — run it manually via an already-approved Bash call and update the task yourself`,
            }),
          };
        }
        const notes = `verify: ${result.ok ? 'PASSED' : 'FAILED'} (exit ${result.exitCode}${result.expectMatched === false ? ', expect not matched' : ''})`;
        try {
          const { result: updated, persisted } = await mutateLedger((target) =>
            target.update(id, { status: result.ok ? 'done' : 'failed', notes }),
          );
          return shapeResult({ task: updated, result }, persisted);
        } catch (error) {
          return { text: JSON.stringify({ error: String(error) }), isError: true };
        }
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
      name: 'worktree_create',
      description:
        'Create an isolated git worktree + branch for a fanned-out task, so concurrent implementers never ' +
        'collide on the same working tree. Lives under .ideal-harness/worktrees/<id>.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, baseRef: { type: 'string' } },
        required: ['id'],
      },
      handler: async (args) => {
        const result = await createWorktree(asString(args, 'id'), { baseRef: asString(args, 'baseRef', 'HEAD') });
        return { text: JSON.stringify(result), ...(result.ok ? {} : { isError: true }) };
      },
    },
    {
      name: 'worktree_list',
      description: 'List worktrees created for fanned-out tasks.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ text: JSON.stringify(await listWorktrees()) }),
    },
    {
      name: 'worktree_remove',
      description: 'Remove a fanned-out task worktree and its branch.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, force: { type: 'boolean' } },
        required: ['id'],
      },
      handler: async (args) => {
        const result = await removeWorktree(asString(args, 'id'), { force: args.force === true });
        return { text: JSON.stringify(result), ...(result.ok ? {} : { isError: true }) };
      },
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
      handler: async (args) => {
        const tokens = asNumber(args, 'tokens', 0);
        // Validate before touching the governor: a non-numeric "tokens" (e.g. "abc")
        // coerces to NaN, which would poison the spend total and disable the cap.
        if (!Number.isFinite(tokens) || tokens < 0) {
          return {
            text: JSON.stringify({ allowed: false, reason: `invalid token count: ${asString(args, 'tokens')}` }),
            isError: true,
          };
        }
        if (spendIo === undefined) {
          const decision = spend.check(tokens);
          if (decision.allowed) {
            spend.record(tokens);
            persistSpend();
          }
          return { text: JSON.stringify({ ...decision, spent: spend.spent(), remaining: spend.remaining() }) };
        }
        // Issue #17 / D039: both the cap CHECK and the record must happen
        // against the freshest cross-process total, under one lock — checking
        // against a stale in-memory total would let two concurrent processes
        // each pass a check that's only individually true, jointly overspending
        // past the cap even though the recorded total itself is never lost.
        try {
          return await withFileLock(spendIo.lockPath, () => {
            spend.restore(spendIo.load());
            const decision = spend.check(tokens);
            if (decision.allowed) {
              const merged = spend.spent() + tokens;
              spendIo.save(merged);
              spend.restore(merged);
            }
            return { text: JSON.stringify({ ...decision, spent: spend.spent(), remaining: spend.remaining() }) };
          });
        } catch (error) {
          return {
            text: JSON.stringify({ allowed: false, reason: `spend state locked: ${String(error)}` }),
            isError: true,
          };
        }
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

/**
 * `existsSync` then `readFileSync` is two syscalls, not one: a concurrent
 * writer's atomic rename can land in the gap between them, turning a
 * perfectly valid file into a spurious `ENOENT` on the read (issue #17).
 * That is a transient race, not evidence of corruption or absence, so it
 * gets one retry before being treated as genuinely missing — mirrors the
 * identical helper in `memory/structural/persist.ts` and
 * `memory/episodic/persist.ts`.
 */
function readIfExists(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    if (!existsSync(path)) {
      return null;
    }
    try {
      return readFileSync(path, 'utf8');
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw retryError;
    }
  }
}

/** Where a workspace's persisted spend checkpoint lives (see issue #14). */
export function spendStatePath(): string {
  return process.env.IDEAL_HARNESS_SPEND_STATE ?? join(process.cwd(), '.ideal-harness', 'orchestrate-spend.json');
}

/** Exported for direct testing of the restart/fail-closed behavior — see issue #14. */
export function writeSpendState(path: string, used: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, serializeSpendState({ used, ts: Date.now() }));
  renameSync(tmp, path);
}

/**
 * Resolve the spend cap's starting point across a restart — see issue #14.
 *
 * A hard cap that silently resets to zero on every MCP subprocess restart is a
 * live bypass, not a theoretical one, so "missing state" is NOT treated the same
 * as "zero prior spend" once a workspace has ever bootstrapped. The distinction:
 *   - No state file has EVER been written for this workspace (this function
 *     always writes one before returning) → genuinely first run, 0 is accurate.
 *   - A state file exists and parses → restore the real prior spend.
 *   - A state file exists but is CORRUPT, or a cap is configured but no state
 *     file exists even though this workspace's ledger already has tasks in it
 *     (strong evidence a prior session ran and its spend state was lost or
 *     tampered with) → FAIL CLOSED to "assume the cap was already reached"
 *     (`capTokens`, or 0 when uncapped, where it's moot anyway) rather than
 *     silently granting a fresh budget. Quarantines the corrupt file (renamed
 *     `.corrupt`) for a human to inspect, same convention as the ledger.
 *
 * Residual, stated gap: this cannot distinguish a workspace whose spend file
 * was deleted immediately after this function's own bootstrap write (before
 * any spend was ever recorded) from a genuinely fresh workspace — both present
 * as "no state file, empty ledger." Closing that fully would need a separate,
 * always-present bootstrap marker independent of the spend file itself; not
 * attempted here since the concrete bug this issue reports — every *ordinary*
 * restart of an in-progress session resetting spend to zero — is fully closed
 * by the mechanism above.
 */
export function resolveInitialSpend(path: string, capTokens: number | null, ledgerHasTasks: boolean): number {
  const raw = readIfExists(path);
  if (raw !== null) {
    try {
      return parseSpendState(raw).used;
    } catch (error) {
      const corruptPath = `${path}.corrupt`;
      try {
        renameSync(path, corruptPath);
      } catch {
        // best-effort quarantine; fail closed regardless
      }
      const failClosedUsed = capTokens ?? 0;
      process.stderr.write(
        `ideal-harness-orchestrate: could not load spend state (${String(error)}); moved corrupt file to ${corruptPath}; failing CLOSED to spent=${failClosedUsed} (assume cap already reached) — run "ideal-harness-orchestrate spend reset" to deliberately clear this\n`,
      );
      return failClosedUsed;
    }
  }
  if (ledgerHasTasks && capTokens !== null) {
    // No spend file, but this workspace has clearly run before (the ledger isn't
    // empty) and a cap is configured — the file is either lost or was never
    // written by a pre-#14 version of this project. Fail closed rather than
    // assume the cap hasn't been touched yet.
    process.stderr.write(
      `ideal-harness-orchestrate: no spend state at ${path} but the ledger already has tasks; failing CLOSED to spent=${capTokens} (assume cap already reached) — run "ideal-harness-orchestrate spend reset" if this is expected\n`,
    );
    writeSpendState(path, capTokens);
    return capTokens;
  }
  // Genuinely first run for this workspace (or uncapped, where it's moot either way).
  writeSpendState(path, 0);
  return 0;
}

/** Load the freshest on-disk ledger (or empty, if none exists yet). Quarantines unreadable content. */
function loadLedgerFresh(ledgerPath: string): TaskLedger {
  const raw = readIfExists(ledgerPath);
  if (raw === null) {
    return new TaskLedger();
  }
  try {
    return TaskLedger.parse(raw);
  } catch (error) {
    // Quarantine an unreadable ledger so we don't hit the same poison pill on
    // every load, but preserve it (renamed) for debugging instead of deleting.
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
    return new TaskLedger();
  }
}

/**
 * Read the freshest on-disk spend total for a lock-protected mid-session
 * reload (issue #17 / D039's `spendIo.load`). Unlike `resolveInitialSpend`
 * (startup-only — handles the genuine-first-run bootstrap case and always
 * writes a state file before returning), this assumes the file was already
 * bootstrapped at startup: if it's missing or corrupt at this point, that's
 * anomalous (deleted or corrupted mid-session, not a fresh workspace), so it
 * fails closed to `capTokens ?? 0` exactly like the corrupt-file path below,
 * rather than silently resetting to a possibly-wrong number.
 */
function readCurrentSpend(path: string, capTokens: number | null): number {
  const raw = readIfExists(path);
  if (raw === null) {
    return capTokens ?? 0;
  }
  try {
    return parseSpendState(raw).used;
  } catch (error) {
    const corruptPath = `${path}.corrupt`;
    try {
      renameSync(path, corruptPath);
    } catch {
      // best-effort quarantine; fail closed regardless
    }
    process.stderr.write(
      `ideal-harness-orchestrate: could not reload spend state (${String(error)}); moved corrupt file to ${corruptPath}; failing CLOSED to spent=${capTokens ?? 0}\n`,
    );
    return capTokens ?? 0;
  }
}

/** Persist a ledger atomically (temp file + rename). */
function saveLedger(ledger: TaskLedger, ledgerPath: string): PersistResult {
  try {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    const tmp = `${ledgerPath}.tmp`;
    writeFileSync(tmp, ledger.serialize());
    renameSync(tmp, ledgerPath);
    return { ok: true };
  } catch (error) {
    process.stderr.write(`ideal-harness-orchestrate: could not persist ledger (${String(error)})\n`);
    return { ok: false, error: String(error) };
  }
}

export function startOrchestrateMcp(): Promise<void> {
  // File-backed ledger so a controller's progress survives an MCP server restart,
  // not just context compaction. Lives under the gitignored .ideal-harness/ dir.
  const ledgerPath =
    process.env.IDEAL_HARNESS_LEDGER ?? join(process.cwd(), '.ideal-harness', 'orchestrate-ledger.json');
  const ledger = loadLedgerFresh(ledgerPath);
  process.stderr.write(`ideal-harness-orchestrate: ledger ${ledgerPath} (${ledger.all().length} task(s) loaded)\n`);

  const capTokens = resolveSpendCap();
  const spendPath = spendStatePath();
  const initialUsed = resolveInitialSpend(spendPath, capTokens, ledger.all().length > 0);
  const spend = new SpendGovernor(capTokens, initialUsed);
  process.stderr.write(
    `ideal-harness-orchestrate: spend ${spendPath} (spent=${spend.spent()}${capTokens === null ? ', uncapped' : `, cap=${capTokens}`})\n`,
  );

  // Issue #17 / decisions.md D039: every mutating tool call locks, reloads
  // the FRESHEST on-disk state, applies its change to that (not to this
  // long-held in-memory `ledger`/`spend`), saves, and resyncs — so a second
  // concurrent MCP process's writes are merged in, never silently clobbered.
  const ledgerIo: LedgerIo = {
    load: () => loadLedgerFresh(ledgerPath),
    save: (l) => saveLedger(l, ledgerPath),
    lockPath: lockPathFor(ledgerPath),
  };
  const spendIo: SpendIo = {
    load: () => readCurrentSpend(spendPath, capTokens),
    save: (used) => writeSpendState(spendPath, used),
    lockPath: lockPathFor(spendPath),
  };

  const tools = buildOrchestrateTools(ledger, new LoopGuard(), spend, undefined, undefined, ledgerIo, spendIo);
  return createMcpServer({ name: 'ideal-harness-orchestrate', version: HARNESS_VERSION, tools }).listen();
}
