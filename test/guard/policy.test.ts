import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULES } from '../../src/guard/policy/defaults.js';
import { evaluate, evaluateTiered } from '../../src/guard/policy/engine.js';
import type { PolicyRule } from '../../src/guard/policy/types.js';

test('deny always wins over allow and ask', () => {
  const rules: PolicyRule[] = [
    { id: 'a', action: 'allow', tool: 'Bash' },
    { id: 'k', action: 'ask', tool: 'Bash' },
    { id: 'd', action: 'deny', tool: 'Bash', match: 'rm' },
  ];
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'rm x' } }, rules).action, 'deny');
});

test('unmatched request fails closed to ask', () => {
  const decision = evaluate({ tool: 'MysteryTool', input: {} }, DEFAULT_RULES);
  assert.equal(decision.action, 'ask');
  assert.equal(decision.ruleId, 'default');
});

test('read-only tools are allowed by default', () => {
  assert.equal(evaluate({ tool: 'Read', input: { file_path: '/repo/src/x.ts' } }, DEFAULT_RULES).action, 'allow');
  assert.equal(evaluate({ tool: 'Grep', input: { pattern: 'foo' } }, DEFAULT_RULES).action, 'allow');
});

test('reading credential files is denied even though Read is otherwise allowed', () => {
  for (const file of ['/home/u/.aws/credentials', '/home/u/.ssh/id_rsa', '/repo/.env']) {
    const decision = evaluate({ tool: 'Read', input: { file_path: file } }, DEFAULT_RULES);
    assert.equal(decision.action, 'deny', `${file} should be denied`);
  }
});

test('self-policy writes are denied', () => {
  assert.equal(
    evaluate({ tool: 'Edit', input: { file_path: '/repo/.claude/settings.json' } }, DEFAULT_RULES).action,
    'deny',
  );
  assert.equal(
    evaluate({ tool: 'Write', input: { file_path: '/repo/.claude-plugin/plugin.json' } }, DEFAULT_RULES).action,
    'deny',
  );
});

test('git push and shell network fetches require approval', () => {
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'git push origin main' } }, DEFAULT_RULES).action, 'ask');
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'curl https://x.com' } }, DEFAULT_RULES).action, 'ask');
});

test('plain shell commands are ask, not allow', () => {
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'ls -la' } }, DEFAULT_RULES).action, 'ask');
});

test('read-only git commands are allowed by default', () => {
  for (const cmd of [
    'git status',
    'git status -sb',
    'git log --oneline -20',
    'git diff HEAD~1',
    'git diff --stat',
    'git log',
  ]) {
    assert.equal(evaluate({ tool: 'Bash', input: { command: cmd } }, DEFAULT_RULES).action, 'allow', cmd);
  }
});

test('git-readonly allow rejects chaining, redirection, and substitution', () => {
  const cases: Array<[string, string]> = [
    ['git status; rm -rf ~/', 'deny'], // chain hits destructive deny
    ['git status && curl https://x.com', 'ask'],
    ['git log | sh', 'ask'],
    ['git diff > /tmp/out', 'ask'],
    ['git log $(whoami)', 'ask'],
    ['git log `whoami`', 'ask'],
    ['git log --output=/tmp/x', 'ask'],
    ['git log -p -- .env', 'ask'],
    ['git diff -- id_rsa', 'ask'],
    ['git push origin main', 'ask'], // push is not in the read-only set
    ['git branch -D main', 'ask'], // branch mutates; not in the set
  ];
  for (const [cmd, expected] of cases) {
    assert.equal(evaluate({ tool: 'Bash', input: { command: cmd } }, DEFAULT_RULES).action, expected, cmd);
  }
});

test('Windows backslash credential paths are denied (no separator bypass)', () => {
  for (const file of [
    'C:\\Users\\bob\\.env',
    'C:\\Users\\bob\\.env.local',
    'C:\\Users\\bob\\.aws\\config',
    'C:\\Users\\bob\\.ssh\\config',
  ]) {
    assert.equal(
      evaluate({ tool: 'Read', input: { file_path: file } }, DEFAULT_RULES).action,
      'deny',
      `${file} should be denied`,
    );
  }
});

test('credential matching is case-insensitive (no upper/mixed-case bypass)', () => {
  for (const file of ['/repo/.ENV', '/home/u/.SSH/ID_RSA', '/home/u/.AWS/CREDENTIALS']) {
    assert.equal(
      evaluate({ tool: 'Read', input: { file_path: file } }, DEFAULT_RULES).action,
      'deny',
      `${file} should be denied`,
    );
  }
});

test('credential matching is anchored — legitimate lookalike files are NOT denied', () => {
  // Anchored patterns must not over-block files that merely contain the substring.
  for (const file of [
    '/repo/src/mycredentials',
    '/repo/notes/old_credentials',
    '/repo/docs/id_rsa_format.md',
    '/repo/keys/my_id_rsa_notes.txt',
    '/repo/src/environment.ts',
  ]) {
    const decision = evaluate({ tool: 'Read', input: { file_path: file } }, DEFAULT_RULES);
    assert.equal(decision.action, 'allow', `${file} should be allowed (false positive)`);
  }
});

test('anchored credential patterns still deny the real files', () => {
  for (const file of [
    '/home/u/credentials',
    '/home/u/.aws/credentials',
    '/tmp/id_rsa',
    '/tmp/id_rsa.pub',
    '/proj/.env.production',
  ]) {
    assert.equal(
      evaluate({ tool: 'Read', input: { file_path: file } }, DEFAULT_RULES).action,
      'deny',
      `${file} should still be denied`,
    );
  }
});

test('evaluateTiered: first tier with a match decides; deny-wins holds inside a tier', () => {
  const userTier: PolicyRule[] = [
    { id: 'u-allow', action: 'allow', tool: 'Bash', match: '^git status' },
    { id: 'u-deny', action: 'deny', tool: 'Bash', match: 'status --secret' },
  ];
  // User tier matches → decides, without consulting the floor.
  assert.equal(
    evaluateTiered({ tool: 'Bash', input: { command: 'git status' } }, [userTier, DEFAULT_RULES]).action,
    'allow',
  );
  // Deny still wins over allow inside the same tier.
  assert.equal(
    evaluateTiered({ tool: 'Bash', input: { command: 'git status --secret' } }, [userTier, DEFAULT_RULES]).action,
    'deny',
  );
  // User tier silent → floor decides.
  assert.equal(
    evaluateTiered({ tool: 'Bash', input: { command: 'npm test' } }, [userTier, DEFAULT_RULES]).action,
    'ask',
  );
});

test('evaluateTiered: nothing matched in any tier fails closed to ask', () => {
  const decision = evaluateTiered({ tool: 'MysteryTool', input: {} }, [[], []]);
  assert.equal(decision.action, 'ask');
  assert.equal(decision.ruleId, 'default');
});

test('editing the policy source itself is denied, on both path styles', () => {
  assert.equal(
    evaluate({ tool: 'Edit', input: { file_path: '/repo/src/guard/policy/defaults.ts' } }, DEFAULT_RULES).action,
    'deny',
  );
  assert.equal(
    evaluate({ tool: 'Write', input: { file_path: 'C:\\repo\\src\\guard\\policy\\engine.ts' } }, DEFAULT_RULES).action,
    'deny',
  );
  assert.equal(
    evaluate({ tool: 'Edit', input: { file_path: 'C:\\repo\\.claude-plugin\\plugin.json' } }, DEFAULT_RULES).action,
    'deny',
  );
});
