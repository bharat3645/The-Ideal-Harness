/**
 * Session resume / checkpoint.
 *
 * A checkpoint captures the phase, the serialized ledger, and an optional
 * cursor, so a crashed or compacted session resumes from where it stopped
 * instead of restarting. Distinct from the artifact ledger: this is the
 * controller's position, not the work products.
 */

import { TaskLedger } from './ledger.js';

export interface Checkpoint {
  readonly phase: string;
  /** Serialized TaskLedger. */
  readonly ledger: string;
  readonly cursor?: string;
  /** Unix ms, supplied by the caller. */
  readonly ts: number;
}

export function serializeCheckpoint(checkpoint: Checkpoint): string {
  return JSON.stringify(checkpoint);
}

export function parseCheckpoint(json: string): Checkpoint {
  const data = JSON.parse(json) as Partial<Checkpoint>;
  if (typeof data.phase !== 'string' || typeof data.ledger !== 'string' || typeof data.ts !== 'number') {
    throw new Error('invalid checkpoint: missing phase/ledger/ts');
  }
  // Validate the embedded ledger is parseable JSON now, at checkpoint-load time,
  // rather than letting it throw lazily inside resumeFrom() much later.
  try {
    JSON.parse(data.ledger);
  } catch {
    throw new Error('invalid checkpoint: ledger is not valid JSON');
  }
  return {
    phase: data.phase,
    ledger: data.ledger,
    ts: data.ts,
    ...(data.cursor !== undefined ? { cursor: data.cursor } : {}),
  };
}

export interface ResumePoint {
  readonly phase: string;
  readonly nextTaskId: string | null;
  readonly progress: { done: number; total: number };
}

/** Compute where to resume from a checkpoint. */
export function resumeFrom(checkpoint: Checkpoint): ResumePoint {
  const ledger = TaskLedger.parse(checkpoint.ledger);
  const next = ledger.nextPending();
  return {
    phase: checkpoint.phase,
    nextTaskId: next?.id ?? null,
    progress: ledger.progress(),
  };
}
