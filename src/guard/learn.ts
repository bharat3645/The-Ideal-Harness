/**
 * Self-learning loop v1 — the VISION §5 flywheel, smallest honest slice:
 *
 *   observe (journal) → analyze (patterns) → PROPOSE (diffs) → human ratifies
 *
 * `proposeAllowRules` reads the guard journal and finds two kinds of shape
 * the human keeps approving:
 *   - Bash command shapes (repeated `ask` outcomes on the same leading tokens)
 *   - WebFetch origins (repeated `ask` outcomes fetching the same domain) —
 *     VISION.md §3.3's "egress domain allowlist": first-use prompt per
 *     domain, remembered thereafter, built on this same ratification
 *     machinery rather than a new mechanism.
 *
 * For each it drafts a narrow, anchored allow rule the operator can paste
 * into `ideal-harness.policy.json` — BY HAND. Nothing here writes policy: the
 * policy file is covered by the self-policy deny, and the learning loop keeps
 * the same asymmetry as the floor itself (proposals learn; the human stays
 * sovereign; the floor never learns on its own).
 *
 * Conservatism rules, encoded not implied:
 *   - Bash and WebFetch only. File mutations (Edit/Write) stay ask —
 *     approving an edit twice is not evidence the *next* edit is safe, and
 *     the same reasoning applies to a URL path, which is why WebFetch
 *     proposals are scoped to the *origin*, never the full URL.
 *   - A shape that EVER produced a deny or a softened deny is never proposed;
 *     near-misses are the opposite of evidence.
 *   - Proposed Bash matches are anchored to the observed command's leading
 *     tokens and reject chaining/redirection metacharacters, mirroring the
 *     built-in `allow-git-readonly` pattern. Proposed WebFetch matches are
 *     anchored to the exact origin with a path/query/end boundary, so
 *     `https://example.com` can never match `https://example.com.evil.com`.
 */

import { readFileSync } from 'node:fs';
import type { GuardJournalEntry } from './journal.js';
import { journalPath, parseJournal } from './journal.js';
import type { PolicyRule } from './policy/types.js';

/** Asks of the same shape required before a proposal is drafted. */
export const DEFAULT_MIN_COUNT = 3;

/** Tail appended to every proposed Bash match: args allowed, metacharacters rejected. */
const SAFE_ARGS_TAIL = '(\\s[^;&|<>`$\\n]*)?$';

export interface AllowProposal {
  /** Normalized shape the proposal covers (e.g. "corepack pnpm", or "https://docs.example.com"). */
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

/**
 * Normalize a WebFetch subject (a URL) to its origin — scheme + host (+ port
 * if non-default) — discarding path, query, and fragment. Learning happens
 * at the domain, never the full URL: approving one fetch to
 * `https://docs.example.com/a` is not evidence `https://docs.example.com/b`
 * (let alone a different domain entirely) is safe. Returns '' for anything
 * that doesn't parse as an absolute URL, mirroring `commandShape`'s '' for
 * an empty command.
 */
export function webFetchOriginShape(subject: string): string {
  try {
    const url = new URL(subject);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

/** Learnable tools and the shape function each uses. Anything else is never learned from. */
function shapeFor(tool: string, subject: string): string {
  if (tool === 'Bash') {
    return commandShape(subject);
  }
  if (tool === 'WebFetch') {
    return webFetchOriginShape(subject);
  }
  return '';
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

/** Build the proposed rule for a learned (tool, shape) pair. */
function buildRule(tool: string, shape: string, count: number, ratifiedByOne: boolean): PolicyRule {
  const verb = ratifiedByOne ? 'ratified by one explicit human approval' : `approved ${count}×`;
  if (tool === 'WebFetch') {
    return {
      id: `u-allow-web-${slugify(shape)}`,
      action: 'allow',
      tool: 'WebFetch',
      // Anchored to the exact origin; the lookahead requires a path/query/
      // fragment boundary or end-of-string, so a suffix domain
      // (`example.com.evil.com`) can never match `example.com`'s rule.
      match: `^${escapeRegex(shape)}(?=[/?#]|$)`,
      description: `learned: fetches to "${shape}" ${verb} (proposed by ideal-harness-guard ${
        ratifiedByOne ? 'ratify' : 'learn'
      }; human-ratified)`,
    };
  }
  return {
    id: `u-allow-${slugify(shape)}`,
    action: 'allow',
    tool: 'Bash',
    match: `^${escapeRegex(shape)}${SAFE_ARGS_TAIL}`,
    description: `learned: "${shape}" ${verb} (proposed by ideal-harness-guard ${
      ratifiedByOne ? 'ratify' : 'learn'
    }; human-ratified)`,
  };
}

/** Analyze journal entries and draft allow-rule proposals. Pure. */
export function proposeAllowRules(
  entries: readonly GuardJournalEntry[],
  minCount: number = DEFAULT_MIN_COUNT,
): AllowProposal[] {
  const asks = new Map<string, { tool: string; shape: string; count: number; sample: string }>();
  const poisoned = new Set<string>(); // `${tool}:${shape}` pairs that ever hit a deny (softened or not)

  for (const entry of entries) {
    if (entry.tool !== 'Bash' && entry.tool !== 'WebFetch') {
      continue;
    }
    const shape = shapeFor(entry.tool, entry.subject);
    if (shape === '') {
      continue;
    }
    const key = `${entry.tool}:${shape}`;
    if (entry.action === 'deny' || entry.softened === true) {
      poisoned.add(key);
      continue;
    }
    if (entry.action === 'ask' && entry.ruleId !== 'egress-secrets') {
      const seen = asks.get(key) ?? { tool: entry.tool, shape, count: 0, sample: entry.subject };
      seen.count += 1;
      asks.set(key, seen);
    }
  }

  const proposals: AllowProposal[] = [];
  for (const [key, { tool, shape, count, sample }] of asks) {
    if (count < minCount || poisoned.has(key)) {
      continue;
    }
    proposals.push({ shape, count, sample, rule: buildRule(tool, shape, count, false) });
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
 *
 * `shape` is interpreted as a WebFetch origin when it parses as an absolute
 * URL (`https://docs.example.com`), and as a Bash command shape otherwise
 * (`npm test`) — no separate tool argument, so the existing single-string
 * CLI contract (`ideal-harness-guard ratify <shape>`) is unchanged.
 */
export function ratifyShape(entries: readonly GuardJournalEntry[], shape: string): AllowProposal | null {
  const tool = webFetchOriginShape(shape) === shape ? 'WebFetch' : 'Bash';
  let poisoned = false;
  let count = 0;
  let sample: string | undefined;
  for (const entry of entries) {
    if (entry.tool !== tool || shapeFor(tool, entry.subject) !== shape) {
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
  return { shape, count, sample: sample ?? shape, rule: buildRule(tool, shape, count, true) };
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
    return 'No proposals: no Bash command or WebFetch origin shape has enough repeated approvals in the journal yet.\n';
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
