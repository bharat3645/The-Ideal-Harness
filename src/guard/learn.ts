/**
 * Self-learning loop v1 — the VISION §5 flywheel, smallest honest slice:
 *
 *   observe (journal) → analyze (patterns) → PROPOSE (diffs) → human ratifies
 *
 * `proposeAllowRules` reads the guard journal and finds Bash command shapes
 * the human keeps approving (repeated `ask` outcomes). For each it drafts a
 * narrow, anchored allow rule the operator can paste into
 * `ideal-harness.policy.json` — BY HAND. Nothing here writes policy: the
 * policy file is covered by the self-policy deny, and the learning loop keeps
 * the same asymmetry as the floor itself (proposals learn; the human stays
 * sovereign; the floor never learns on its own).
 *
 * Conservatism rules, encoded not implied:
 *   - Bash-only in v1. File mutations (Edit/Write) stay ask — approving an
 *     edit twice is not evidence the *next* edit is safe.
 *   - A shape that EVER produced a deny or a softened deny is never proposed;
 *     near-misses are the opposite of evidence.
 *   - Proposed matches are anchored to the observed command's leading tokens
 *     and reject chaining/redirection metacharacters, mirroring the built-in
 *     `allow-git-readonly` pattern.
 */

import { readFileSync } from 'node:fs';
import type { GuardJournalEntry } from './journal.js';
import { journalPath, parseJournal } from './journal.js';
import type { PolicyRule } from './policy/types.js';

/** Asks of the same shape required before a proposal is drafted. */
export const DEFAULT_MIN_COUNT = 3;

/** Tail appended to every proposed match: args allowed, metacharacters rejected. */
const SAFE_ARGS_TAIL = '(\\s[^;&|<>`$\\n]*)?$';

export interface AllowProposal {
  /** Normalized command shape the proposal covers (e.g. "corepack pnpm"). */
  readonly shape: string;
  /** How many times the human approved this shape. */
  readonly count: number;
  /** One observed example, for the human to sanity-check. */
  readonly sample: string;
  /** The rule to paste into ideal-harness.policy.json — after human review. */
  readonly rule: PolicyRule;
}

/** Normalize a Bash subject to its leading one-or-two-token shape. */
export function commandShape(subject: string): string {
  const tokens = subject.trim().split(/\s+/);
  const head = tokens.slice(0, 2).filter((t) => t !== '' && !t.startsWith('-'));
  return head.join(' ');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(shape: string): string {
  return shape
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Analyze journal entries and draft allow-rule proposals. Pure. */
export function proposeAllowRules(
  entries: readonly GuardJournalEntry[],
  minCount: number = DEFAULT_MIN_COUNT,
): AllowProposal[] {
  const asks = new Map<string, { count: number; sample: string }>();
  const poisoned = new Set<string>(); // shapes that ever hit a deny (softened or not)

  for (const entry of entries) {
    if (entry.tool !== 'Bash') {
      continue;
    }
    const shape = commandShape(entry.subject);
    if (shape === '') {
      continue;
    }
    if (entry.action === 'deny' || entry.softened === true) {
      poisoned.add(shape);
      continue;
    }
    if (entry.action === 'ask' && entry.ruleId !== 'egress-secrets') {
      const seen = asks.get(shape) ?? { count: 0, sample: entry.subject };
      seen.count += 1;
      asks.set(shape, seen);
    }
  }

  const proposals: AllowProposal[] = [];
  for (const [shape, { count, sample }] of asks) {
    if (count < minCount || poisoned.has(shape)) {
      continue;
    }
    proposals.push({
      shape,
      count,
      sample,
      rule: {
        id: `u-allow-${slugify(shape)}`,
        action: 'allow',
        tool: 'Bash',
        match: `^${escapeRegex(shape)}${SAFE_ARGS_TAIL}`,
        description: `learned: "${shape}" approved ${count}× (proposed by ideal-harness-guard learn; human-ratified)`,
      },
    });
  }
  return proposals.sort((a, b) => b.count - a.count);
}

/** Read the project journal and propose. Missing journal → no proposals. */
export function learnFromJournal(cwd: string = process.cwd(), minCount: number = DEFAULT_MIN_COUNT): AllowProposal[] {
  let text: string;
  try {
    text = readFileSync(journalPath(cwd), 'utf8');
  } catch {
    return [];
  }
  return proposeAllowRules(parseJournal(text), minCount);
}

/** Human-facing rendering with the ratification instructions. */
export function formatProposals(proposals: readonly AllowProposal[]): string {
  if (proposals.length === 0) {
    return 'No proposals: no Bash command shape has enough repeated approvals in the journal yet.\n';
  }
  const lines: string[] = [
    `${proposals.length} proposal(s) from repeated approvals. Review each; paste the ones you`,
    'trust into ideal-harness.policy.json under "rules". The harness will NOT apply them itself.',
    '',
  ];
  for (const p of proposals) {
    lines.push(`# "${p.shape}" — approved ${p.count}× (e.g. \`${p.sample}\`)`);
    lines.push(JSON.stringify(p.rule, null, 2));
    lines.push('');
  }
  return `${lines.join('\n')}`;
}
