import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULES } from '../src/policy/defaults.js';
import { evaluate } from '../src/policy/engine.js';
import type { PolicyRule } from '../src/policy/types.js';

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
    evaluate({ tool: 'Write', input: { file_path: '/repo/packages/x/.claude-plugin/plugin.json' } }, DEFAULT_RULES)
      .action,
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
