/**
 * Ledger retro — a markdown summary of a ledger's outcome: task counts by
 * status, and (the honest metric this project cares about) how many "done"
 * tasks were actually verified by a real command versus merely asserted.
 * Pure string generation; no I/O, no clock (the caller supplies `now`).
 */

import type { LedgerTask } from './ledger.js';

export interface RetroOptions {
  readonly now: number;
  readonly title?: string;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`;
}

/** Generate a markdown retro from a ledger's tasks. */
export function generateRetro(tasks: readonly LedgerTask[], options: RetroOptions): string {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done');
  const failed = tasks.filter((t) => t.status === 'failed');
  const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const withVerify = tasks.filter((t) => t.verify !== undefined);
  const doneVerified = done.filter((t) => t.verify !== undefined);
  const doneAsserted = done.filter((t) => t.verify === undefined);

  const lines: string[] = [
    `# ${options.title ?? 'Ledger retro'}`,
    '',
    `Generated ${new Date(options.now).toISOString()}`,
    '',
    '## Summary',
    '',
    `- Total tasks: ${total}`,
    `- Done: ${done.length} (${pct(done.length, total)})`,
    `- Failed: ${failed.length} (${pct(failed.length, total)})`,
    `- Pending/in-progress: ${pending.length}`,
    `- Tasks with a verify command set: ${withVerify.length}/${total} (${pct(withVerify.length, total)})`,
    `- Done tasks verified by a real command: ${doneVerified.length}/${done.length} (${pct(doneVerified.length, done.length)})`,
    `- Done tasks marked done WITHOUT a verify command (asserted, not measured): ${doneAsserted.length}`,
    '',
  ];

  if (failed.length > 0) {
    lines.push('## Failed tasks', '');
    for (const t of failed) {
      lines.push(`- **${t.id}** — ${t.title}${t.notes ? `: ${t.notes}` : ''}`);
    }
    lines.push('');
  }

  if (doneAsserted.length > 0) {
    lines.push('## Done without verification (review these)', '');
    for (const t of doneAsserted) {
      lines.push(`- **${t.id}** — ${t.title}`);
    }
    lines.push('');
  }

  lines.push('## All tasks', '');
  for (const t of tasks) {
    const verifyNote = t.verify !== undefined ? ` (verify: \`${t.verify.command}\`)` : '';
    lines.push(`- [${t.status}] **${t.id}** — ${t.title}${verifyNote}`);
  }
  lines.push('');

  return lines.join('\n');
}
