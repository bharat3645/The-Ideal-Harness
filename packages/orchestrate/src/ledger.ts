/**
 * Durable task ledger (Superpowers idea).
 *
 * A controller drives work task-by-task; the ledger is the durable record of
 * what's planned, in-flight, and done, with the artifact each task produced.
 * It serializes to JSON so it survives context compaction and crashes — the
 * controller's memory lives on disk, not in the context window.
 */

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface LedgerTask {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** Path/handle to the artifact this task produced (file-handoff discipline). */
  readonly artifact?: string;
  readonly notes?: string;
}

export class TaskLedger {
  private readonly tasks: LedgerTask[] = [];
  private counter = 0;

  add(title: string, id?: string): LedgerTask {
    this.counter += 1;
    const task: LedgerTask = { id: id ?? `t${this.counter}`, title, status: 'pending' };
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
    return this.tasks;
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
    const data = JSON.parse(json) as { counter?: number; tasks?: LedgerTask[] };
    const ledger = new TaskLedger();
    for (const task of data.tasks ?? []) {
      ledger.tasks.push(task);
    }
    ledger.counter = data.counter ?? ledger.tasks.length;
    return ledger;
  }
}
