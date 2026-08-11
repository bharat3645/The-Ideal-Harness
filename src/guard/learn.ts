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

/**
 * Ratify a single shape immediately, bypassing the repeat-count threshold —
 * for when a human explicitly wants to trust something after just one
 * approval instead of waiting for `DEFAULT_MIN_COUNT` repeats. Still refuses
 * a shape that ever produced a deny or softened deny; still produces only a
 * proposal, never an applied rule.
 */
export function ratifyShape(entries: readonly GuardJournalEntry[], shape: string): AllowProposal | null {
  let poisoned = false;
  let count = 0;
  let sample: string | undefined;
  for (const entry of entries) {
    if (entry.tool !== 'Bash' || commandShape(entry.subject) !== shape) {
      continue;
    }
    if (entry.action === 'deny' || entry.softened === true) {
      poisoned = true;
      continue;
    }
    if (entry.action === 'ask' && entry.ruleId !== 'egress-secrets') {
      count += 1;
      sample = sample ?? entry.subject;
    }
  }
  if (poisoned || count === 0) {
    return null;
  }
  return {
    shape,
    count,
    sample: sample ?? shape,
    rule: {
      id: `u-allow-${slugify(shape)}`,
      action: 'allow',
      tool: 'Bash',
      match: `^${escapeRegex(shape)}${SAFE_ARGS_TAIL}`,
      description: `learned: "${shape}" ratified by one explicit human approval (proposed by ideal-harness-guard ratify; human-ratified)`,
    },
  };
}

/** Read the project journal and ratify one shape by id. Missing journal → null. */
export function ratifyFromJournal(shape: string, cwd: string = process.cwd()): AllowProposal | null {
  let text: string;
  try {
    text = readFileSync(journalPath(cwd), 'utf8');
  } catch {
    return null;
  }
  return ratifyShape(parseJournal(text), shape);
}

export interface AskDigestEntry {
  readonly tool: string;
  readonly shape: string;
  readonly ruleId: string;
  readonly count: number;
  readonly firstTs: string;
  readonly lastTs: string;
  readonly sample: string;
}

interface MutableAskDigestEntry {
  tool: string;
  shape: string;
  ruleId: string;
  count: number;
  firstTs: string;
  lastTs: string;
  sample: string;
}

/** Group journal 'ask' decisions by (tool, normalized shape) for one batch review pass. */
export function summarizeAsks(entries: readonly GuardJournalEntry[]): AskDigestEntry[] {
  const groups = new Map<string, MutableAskDigestEntry>();
  for (const entry of entries) {
    if (entry.action !== 'ask') {
      continue;
    }
    const shape = entry.tool === 'Bash' ? commandShape(entry.subject) || entry.subject : entry.subject;
    const key = `${entry.tool}:${shape}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        tool: entry.tool,
        shape,
        ruleId: entry.ruleId,
        count: 1,
        firstTs: entry.ts,
        lastTs: entry.ts,
        sample: entry.subject,
      });
    } else {
      existing.count += 1;
      if (entry.ts < existing.firstTs) existing.firstTs = entry.ts;
      if (entry.ts > existing.lastTs) existing.lastTs = entry.ts;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Human-facing digest of pending/recent asks, for one review pass instead of N interruptions. */
export function formatAskDigest(digest: readonly AskDigestEntry[]): string {
  if (digest.length === 0) {
    return 'No ask decisions in the journal yet.\n';
  }
  const lines = [`${digest.length} distinct ask shape(s), most frequent first:`, ''];
  for (const d of digest) {
    lines.push(`${d.count}x  [${d.tool}] "${d.shape}"  (rule=${d.ruleId}, ${d.firstTs} .. ${d.lastTs})`);
    lines.push(`      e.g. ${d.sample}`);
  }
  return `${lines.join('\n')}\n`;
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
