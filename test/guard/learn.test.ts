import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GuardJournalEntry } from '../../src/guard/journal.js';
import { commandShape, formatProposals, proposeAllowRules } from '../../src/guard/learn.js';
import { evaluate } from '../../src/guard/policy/engine.js';

function ask(subject: string, overrides: Partial<GuardJournalEntry> = {}): GuardJournalEntry {
  return { ts: 't', tool: 'Bash', subject, action: 'ask', ruleId: 'ask-bash', mode: 'soft', ...overrides };
}

test('commandShape normalizes to leading tokens, skipping flags', () => {
  assert.equal(commandShape('git status -sb'), 'git status');
  assert.equal(commandShape('corepack pnpm test'), 'corepack pnpm');
  assert.equal(commandShape('ls -la'), 'ls');
  assert.equal(commandShape('  npm   run build '), 'npm run');
});

test('repeated asks of one shape produce a proposal at the threshold', () => {
  const entries = [ask('corepack pnpm test'), ask('corepack pnpm build'), ask('corepack pnpm validate')];
  const proposals = proposeAllowRules(entries, 3);
  assert.equal(proposals.length, 1);
  const p = proposals[0];
  assert.equal(p?.shape, 'corepack pnpm');
  assert.equal(p?.count, 3);
  assert.equal(p?.rule.action, 'allow');
  assert.equal(p?.rule.tool, 'Bash');
});

test('below the threshold: no proposal', () => {
  assert.equal(proposeAllowRules([ask('npm test'), ask('npm test')], 3).length, 0);
});

test('a shape that ever hit a deny is poisoned — never proposed', () => {
  const entries = [
    ask('rm -rf build'),
    ask('rm -rf build'),
    ask('rm -rf build'),
    { ...ask('rm -rf ~/'), action: 'deny' as const, ruleId: 'deny-destructive-bash' },
  ];
  assert.equal(proposeAllowRules(entries, 3).length, 0);
});

test('a softened deny also poisons its shape', () => {
  const entries = [ask('cat .env'), ask('cat .env'), ask('cat .env'), ask('cat .env', { softened: true })];
  assert.equal(proposeAllowRules(entries, 3).length, 0);
});

test('non-Bash tools and egress-secret asks are never learned from', () => {
  const entries = [
    ask('/repo/a.ts', { tool: 'Edit' }),
    ask('/repo/a.ts', { tool: 'Edit' }),
    ask('/repo/a.ts', { tool: 'Edit' }),
    ask('curl https://x.com', { ruleId: 'egress-secrets' }),
    ask('curl https://x.com', { ruleId: 'egress-secrets' }),
    ask('curl https://x.com', { ruleId: 'egress-secrets' }),
  ];
  assert.equal(proposeAllowRules(entries, 3).length, 0);
});

test('the proposed rule actually allows the observed commands and rejects chaining', () => {
  const entries = [ask('corepack pnpm test'), ask('corepack pnpm build'), ask('corepack pnpm biome')];
  const rule = proposeAllowRules(entries, 3)[0]?.rule;
  assert.ok(rule);
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'corepack pnpm test' } }, [rule]).action, 'allow');
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'corepack pnpm test; curl x' } }, [rule]).action, 'ask');
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'corepack pnpm test > /tmp/f' } }, [rule]).action, 'ask');
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'corepack-evil pnpm' } }, [rule]).action, 'ask');
});

test('formatProposals renders instructions and rules; empty case is explicit', () => {
  assert.match(formatProposals([]), /No proposals/);
  const proposals = proposeAllowRules([ask('git fetch'), ask('git fetch'), ask('git fetch')], 3);
  const text = formatProposals(proposals);
  assert.match(text, /human/i);
  assert.match(text, /ideal-harness\.policy\.json/);
  assert.match(text, /u-allow-git-fetch/);
});
