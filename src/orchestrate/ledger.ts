/**
 * Durable task ledger (Superpowers idea).
 *
 * A controller drives work task-by-task; the ledger is the durable record of
 * what's planned, in-flight, and done, with the artifact each task produced.
 * It serializes to JSON so it survives context compaction and crashes — the
 * controller's memory lives on disk, not in the context window.
 */

/** The only valid task statuses. Shared so the MCP boundary and parse() agree. */
export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'failed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Type guard for an untrusted status string crossing the MCP boundary. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/** Type guard for an untrusted verify object crossing the MCP boundary or a persisted ledger. */
export function isTaskVerify(value: unknown): value is TaskVerify {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const v = value as { command?: unknown; expect?: unknown };
  return typeof v.command === 'string' && (v.expect === undefined || typeof v.expect === 'string');
}

/**
 * How to verify a task is actually done: a command to run and (optionally) an
 * observation to expect. Turns "done" into a measurement instead of an
 * assertion — the reviewer re-runs `command` rather than trusting the
 * implementer's report.
 */
export interface TaskVerify {
  readonly command: string;
  readonly expect?: string;
}

export interface LedgerTask {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** Path/handle to the artifact this task produced (file-handoff discipline). */
  readonly artifact?: string;
  readonly notes?: string;
  /** How to verify this task is done. Set at creation when possible (verification-first). */
  readonly verify?: TaskVerify;
}

export class TaskLedger {
  private readonly tasks: LedgerTask[] = [];
  private counter = 0;

  add(title: string, id?: string, verify?: TaskVerify): LedgerTask {
    this.counter += 1;
    const task: LedgerTask = {
      id: id ?? `t${this.counter}`,
      title,
      status: 'pending',
      ...(verify ? { verify } : {}),
    };
    this.tasks.push(task);
    return task;
  }

  update(id: string, patch: Partial<Omit<LedgerTask, 'id'>>): LedgerTask {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`no ledger task with id "${id}"`);
    }
    const updated = { ...(this.tasks[index] as LedgerTask), ...patch };
    this.tasks[index] = updated;
    return updated;
  }

  get(id: string): LedgerTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  all(): readonly LedgerTask[] {
    // Return a copy so callers cannot structurally mutate the ledger (push/splice)
    // behind the controlled add()/update() API. The task objects themselves are
    // readonly and replaced wholesale by update().
    return [...this.tasks];
  }

  /** First task not yet done/failed — what a resumed controller should pick up. */
  nextPending(): LedgerTask | undefined {
    return this.tasks.find((t) => t.status === 'pending' || t.status === 'in_progress');
  }

  progress(): { done: number; total: number } {
    return { done: this.tasks.filter((t) => t.status === 'done').length, total: this.tasks.length };
  }

  serialize(): string {
    return JSON.stringify({ counter: this.counter, tasks: this.tasks });
  }

  static parse(json: string): TaskLedger {
    const data = JSON.parse(json) as { counter?: number; tasks?: unknown[] };
    const ledger = new TaskLedger();
    for (const raw of data.tasks ?? []) {
      if (raw === null || typeof raw !== 'object') {
        continue; // skip corrupt entries rather than admit a malformed task
      }
      const t = raw as Partial<LedgerTask>;
      if (typeof t.id !== 'string' || typeof t.title !== 'string') {
        continue;
      }
      // A task with a missing/invalid status would be unreachable to nextPending()
      // and stick forever — default it to 'pending' so a resume can pick it up.
      const status: TaskStatus = isTaskStatus(t.status) ? t.status : 'pending';
      const verify = isTaskVerify(t.verify) ? t.verify : undefined;
      ledger.tasks.push({
        id: t.id,
        title: t.title,
        status,
        ...(typeof t.artifact === 'string' ? { artifact: t.artifact } : {}),
        ...(typeof t.notes === 'string' ? { notes: t.notes } : {}),
        ...(verify ? { verify } : {}),
      });
    }
    // Counter must exceed every existing `tN` id, or add() will mint a colliding id.
    const maxNumericId = ledger.tasks.reduce((max, t) => {
      const m = /^t(\d+)$/.exec(t.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    ledger.counter = Math.max(typeof data.counter === 'number' ? data.counter : 0, maxNumericId);
    return ledger;
  }
}
