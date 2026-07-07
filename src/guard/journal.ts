/**
 * Guard decision journal — "nothing invisible."
 *
 * Every PreToolUse decision is appended as one JSON line to a project-local,
 * append-only journal: what was asked, what the floor decided, under which
 * mode, and whether the decision was softened. This is the substrate for
 * auditing ("why did that happen") and for the self-learning loop (`learn.ts`
 * reads the journal to *propose* policy entries — never to apply them).
 *
 * Properties:
 *   - Project-local (`<cwd>/.ideal-harness/guard-journal.jsonl`), never $HOME —
 *     same isolation contract as memory. The directory is already gitignored.
 *   - Subjects are secret-redacted and truncated BEFORE they are written; the
 *     journal must never become the leak it exists to prevent.
 *   - Fail-open, silent: journaling is observability, not enforcement. A full
 *     disk must never block a tool call.
 *   - `IDEAL_HARNESS_JOURNAL=off` is the kill-switch.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FloorMode } from './bypass.js';
import type { PolicyDecision } from './policy/types.js';
import { redactSecrets } from './redact.js';

export const JOURNAL_ENV_VAR = 'IDEAL_HARNESS_JOURNAL';

/** Max subject length persisted per entry — enough to learn from, small enough to stay lean. */
export const JOURNAL_SUBJECT_MAX = 240;

export interface GuardJournalEntry {
  /** ISO-8601 timestamp, supplied by the caller (keeps this module pure of clocks). */
  readonly ts: string;
  readonly tool: string;
  /** Redacted, truncated subject (command / path / url) the decision was made on. */
  readonly subject: string;
  readonly action: PolicyDecision['action'];
  readonly ruleId: string;
  readonly mode: FloorMode;
  /** Present (true) only when a deny was downgraded by soft mode. */
  readonly softened?: boolean;
}

export interface BuildEntryInput {
  readonly ts: string;
  readonly tool: string;
  readonly subject: string;
  readonly decision: PolicyDecision;
  readonly mode: FloorMode;
  readonly softened?: boolean;
}

/** Build a journal entry: redact + truncate the subject, keep only what auditing needs. */
export function buildJournalEntry(input: BuildEntryInput): GuardJournalEntry {
  const redacted = redactSecrets(input.subject).text;
  const subject = redacted.length > JOURNAL_SUBJECT_MAX ? `${redacted.slice(0, JOURNAL_SUBJECT_MAX)}…` : redacted;
  return {
    ts: input.ts,
    tool: input.tool,
    subject,
    action: input.decision.action,
    ruleId: input.decision.ruleId,
    mode: input.mode,
    ...(input.softened === true ? { softened: true } : {}),
  };
}

/** The project-local journal path. */
export function journalPath(cwd: string = process.cwd()): string {
  return join(cwd, '.ideal-harness', 'guard-journal.jsonl');
}

export interface AppendOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Append one entry. Returns true when written, false when disabled or on any
 * I/O failure — never throws. Observability must never block enforcement.
 */
export function appendJournalEntry(entry: GuardJournalEntry, options: AppendOptions = {}): boolean {
  const { cwd = process.cwd(), env = process.env } = options;
  if (env[JOURNAL_ENV_VAR]?.trim().toLowerCase() === 'off') {
    return false;
  }
  try {
    const path = journalPath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Parse journal lines tolerantly: malformed lines are skipped, never fatal. */
export function parseJournal(text: string): GuardJournalEntry[] {
  const entries: GuardJournalEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Partial<GuardJournalEntry>;
      if (
        typeof parsed.tool === 'string' &&
        typeof parsed.subject === 'string' &&
        typeof parsed.action === 'string' &&
        typeof parsed.ruleId === 'string'
      ) {
        entries.push(parsed as GuardJournalEntry);
      }
    } catch {
      // skip malformed line
    }
  }
  return entries;
}
