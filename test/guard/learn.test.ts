import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GuardJournalEntry } from '../../src/guard/journal.js';
import {
  commandShape,
  formatAskDigest,
  formatProposals,
  proposeAllowRules,
  ratifyShape,
  summarizeAsks,
  webFetchOriginShape,
} from '../../src/guard/learn.js';
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

test('ratifyShape proposes from a single approval, bypassing the repeat threshold', () => {
  const proposal = ratifyShape([ask('npm test')], 'npm test');
  assert.ok(proposal);
  assert.equal(proposal?.count, 1);
  assert.equal(proposal?.rule.action, 'allow');
});

test('ratifyShape refuses a shape that ever hit a deny', () => {
  const entries = [ask('rm -rf build'), { ...ask('rm -rf build'), action: 'deny' as const, ruleId: 'deny-x' }];
  assert.equal(ratifyShape(entries, 'rm -rf'), null);
});

test('ratifyShape returns null when the shape was never asked', () => {
  assert.equal(ratifyShape([ask('npm test')], 'yarn build'), null);
});

test('summarizeAsks groups Bash entries by normalized shape and counts them', () => {
  const entries = [ask('corepack pnpm test'), ask('corepack pnpm build'), ask('git status', { tool: 'Bash' })];
  const digest = summarizeAsks(entries);
  assert.equal(digest.length, 2);
  assert.equal(digest[0]?.shape, 'corepack pnpm');
  assert.equal(digest[0]?.count, 2);
});

test('summarizeAsks groups non-Bash tools by raw subject', () => {
  const entries = [ask('/repo/a.ts', { tool: 'Edit' }), ask('/repo/a.ts', { tool: 'Edit' })];
  const digest = summarizeAsks(entries);
  assert.equal(digest.length, 1);
  assert.equal(digest[0]?.count, 2);
  assert.equal(digest[0]?.tool, 'Edit');
});

test('summarizeAsks ignores non-ask decisions', () => {
  const entries = [{ ...ask('git status'), action: 'allow' as const }];
  assert.equal(summarizeAsks(entries).length, 0);
});

test('formatAskDigest renders counts; empty case is explicit', () => {
  assert.match(formatAskDigest([]), /No ask decisions/);
  const digest = summarizeAsks([ask('npm test'), ask('npm test')]);
  const text = formatAskDigest(digest);
  assert.match(text, /2x/);
  assert.match(text, /npm test/);
});

function askWeb(subject: string, overrides: Partial<GuardJournalEntry> = {}): GuardJournalEntry {
  return { ts: 't', tool: 'WebFetch', subject, action: 'ask', ruleId: 'ask-webfetch', mode: 'soft', ...overrides };
}

test('webFetchOriginShape reduces a URL to scheme+host, dropping path/query/fragment', () => {
  assert.equal(webFetchOriginShape('https://docs.example.com/a/b?c=1#d'), 'https://docs.example.com');
  assert.equal(webFetchOriginShape('https://example.com:8443/x'), 'https://example.com:8443');
  assert.equal(webFetchOriginShape('not a url'), '');
  assert.equal(webFetchOriginShape(''), '');
});

test('repeated WebFetch asks to one origin produce a proposal at the threshold', () => {
  const entries = [
    askWeb('https://docs.example.com/a'),
    askWeb('https://docs.example.com/b?x=1'),
    askWeb('https://docs.example.com/'),
  ];
  const proposals = proposeAllowRules(entries, 3);
  assert.equal(proposals.length, 1);
  const p = proposals[0];
  assert.equal(p?.shape, 'https://docs.example.com');
  assert.equal(p?.count, 3);
  assert.equal(p?.rule.action, 'allow');
  assert.equal(p?.rule.tool, 'WebFetch');
  assert.equal(p?.rule.id, 'u-allow-web-https-docs-example-com');
});

test('a WebFetch origin that ever hit a deny is poisoned — never proposed', () => {
  const entries = [
    askWeb('https://evil.example/a'),
    askWeb('https://evil.example/b'),
    askWeb('https://evil.example/c'),
    { ...askWeb('https://evil.example/d'), action: 'deny' as const, ruleId: 'deny-x' },
  ];
  assert.equal(proposeAllowRules(entries, 3).length, 0);
});

test('Bash and WebFetch shapes are tracked independently — no cross-tool bleed', () => {
  const entries = [
    ask('git fetch'),
    ask('git fetch'),
    ask('git fetch'),
    askWeb('https://git.example/a'),
    askWeb('https://git.example/b'),
  ];
  const proposals = proposeAllowRules(entries, 3);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.rule.tool, 'Bash');
});

test('the proposed WebFetch rule anchors to the origin and rejects a suffix-domain attack', () => {
  const entries = [askWeb('https://example.com/a'), askWeb('https://example.com/b'), askWeb('https://example.com/c')];
  const rule = proposeAllowRules(entries, 3)[0]?.rule;
  assert.ok(rule);
  assert.equal(evaluate({ tool: 'WebFetch', input: { url: 'https://example.com/anything' } }, [rule]).action, 'allow');
  assert.equal(evaluate({ tool: 'WebFetch', input: { url: 'https://example.com' } }, [rule]).action, 'allow');
  assert.equal(evaluate({ tool: 'WebFetch', input: { url: 'https://example.com.evil.com/a' } }, [rule]).action, 'ask');
  assert.equal(evaluate({ tool: 'WebFetch', input: { url: 'http://example.com/a' } }, [rule]).action, 'ask');
});

test('ratifyShape auto-detects WebFetch from a URL-shaped argument, no separate tool param needed', () => {
  const entries = [askWeb('https://docs.example.com/one-page')];
  const proposal = ratifyShape(entries, 'https://docs.example.com');
  assert.ok(proposal);
  assert.equal(proposal?.rule.tool, 'WebFetch');
  assert.equal(proposal?.count, 1);
});

test('ratifyShape for a WebFetch origin refuses one that ever hit a deny', () => {
  const entries = [
    askWeb('https://x.example/a'),
    { ...askWeb('https://x.example/b'), action: 'deny' as const, ruleId: 'deny-x' },
  ];
  assert.equal(ratifyShape(entries, 'https://x.example'), null);
});
