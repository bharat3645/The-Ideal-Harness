import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_RULES } from '../../src/guard/policy/defaults.js';
import { evaluate, evaluateTiered } from '../../src/guard/policy/engine.js';
import {
  composePolicy,
  composePolicyTiers,
  loadTeamPolicy,
  loadUserPolicy,
  parseUserPolicy,
  TEAM_POLICY_ENV_VAR,
  teamPolicyPath,
  USER_POLICY_ENV_VAR,
} from '../../src/guard/policy/load.js';

test('parseUserPolicy accepts valid rules and disable list', () => {
  const parsed = parseUserPolicy(
    {
      disable: ['ask-bash'],
      rules: [{ id: 'u-allow-git-ro', action: 'allow', tool: 'Bash', match: '^git (status|log)\\b' }],
    },
    'test.json',
  );
  assert.equal(parsed.rules.length, 1);
  assert.deepEqual(parsed.disable, ['ask-bash']);
  assert.deepEqual(parsed.warnings, []);
});

test('parseUserPolicy skips malformed rules with warnings, keeps valid ones', () => {
  const parsed = parseUserPolicy(
    {
      rules: [
        { id: 'ok', action: 'allow', tool: 'Bash' },
        { id: '', action: 'allow' }, // empty id
        { id: 'bad-action', action: 'yolo' }, // invalid action
        { id: 'bad-regex', action: 'deny', match: '(' }, // regex does not compile
        { id: 'default', action: 'allow' }, // reserved sentinel id
        'not-an-object',
      ],
    },
    'test.json',
  );
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0]?.id, 'ok');
  assert.equal(parsed.warnings.length, 5);
});

test('parseUserPolicy ignores a non-object document', () => {
  const parsed = parseUserPolicy([1, 2, 3], 'test.json');
  assert.equal(parsed.rules.length, 0);
  assert.equal(parsed.warnings.length, 1);
});

test('composePolicy: user allow beats default ask via tier order', () => {
  const user = parseUserPolicy(
    { rules: [{ id: 'u-allow-pnpm', action: 'allow', tool: 'Bash', match: '^corepack pnpm (test|build)\\b' }] },
    'test.json',
  );
  const { tiers } = composePolicy(user);
  // Default floor alone says ask for a pnpm build command…
  assert.equal(evaluate({ tool: 'Bash', input: { command: 'corepack pnpm test' } }, DEFAULT_RULES).action, 'ask');
  // …the user tier softens exactly the matched commands to allow…
  assert.equal(evaluateTiered({ tool: 'Bash', input: { command: 'corepack pnpm test' } }, tiers).action, 'allow');
  // …and everything else still falls through to the default floor.
  assert.equal(evaluateTiered({ tool: 'Bash', input: { command: 'rm -rf ~/' } }, tiers).action, 'deny');
  assert.equal(evaluateTiered({ tool: 'Bash', input: { command: 'npm install' } }, tiers).action, 'ask');
});

test('composePolicy: disabling a default rule removes it from the floor', () => {
  const user = parseUserPolicy({ disable: ['ask-bash'] }, 'test.json');
  const { tiers, warnings } = composePolicy(user);
  // With ask-bash gone, an unmatched Bash command fails closed to the default ask…
  const decision = evaluateTiered({ tool: 'Bash', input: { command: 'ls' } }, tiers);
  assert.equal(decision.action, 'ask');
  assert.equal(decision.ruleId, 'default');
  // …and disabling a non-deny rule produces no softening warning.
  assert.deepEqual(warnings, []);
});

test('composePolicy warns loudly when a default DENY rule is disabled', () => {
  const user = parseUserPolicy({ disable: ['deny-read-credentials'] }, 'test.json');
  const { tiers, warnings } = composePolicy(user);
  assert.equal(evaluateTiered({ tool: 'Read', input: { file_path: '/repo/.env' } }, tiers).action, 'allow');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /DENY.*deny-read-credentials.*softened/);
});

test('composePolicy warns on unknown disable ids', () => {
  const { warnings } = composePolicy(parseUserPolicy({ disable: ['no-such-rule'] }, 'test.json'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /no default rule/);
});

test('loadUserPolicy merges files, skips absent ones, ignores broken JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-policy-'));
  try {
    const good = join(dir, 'ideal-harness.policy.json');
    const broken = join(dir, 'broken.json');
    writeFileSync(good, JSON.stringify({ rules: [{ id: 'u1', action: 'allow', tool: 'Grep' }] }));
    writeFileSync(broken, '{ not json');
    const policy = loadUserPolicy({ paths: [good, broken, join(dir, 'absent.json')], env: {} });
    assert.equal(policy.rules.length, 1);
    assert.deepEqual(policy.sources, [good]);
    assert.equal(policy.warnings.length, 1);
    assert.match(policy.warnings[0] ?? '', /invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadUserPolicy kill-switch: IDEAL_HARNESS_USER_POLICY=off ignores files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-policy-'));
  try {
    const file = join(dir, 'ideal-harness.policy.json');
    writeFileSync(file, JSON.stringify({ rules: [{ id: 'u1', action: 'allow' }] }));
    const policy = loadUserPolicy({ paths: [file], env: { [USER_POLICY_ENV_VAR]: 'off' } });
    assert.equal(policy.rules.length, 0);
    assert.equal(policy.sources.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTeamPolicy reads .ideal-harness/team-policy.json and returns empty when absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-team-policy-'));
  try {
    assert.deepEqual(loadTeamPolicy({ cwd: dir, env: {} }).rules, []);
    mkdirSync(join(dir, '.ideal-harness'), { recursive: true });
    writeFileSync(teamPolicyPath(dir), JSON.stringify({ rules: [{ id: 't1', action: 'allow', tool: 'Grep' }] }));
    const policy = loadTeamPolicy({ cwd: dir, env: {} });
    assert.equal(policy.rules.length, 1);
    assert.equal(policy.rules[0]?.id, 't1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTeamPolicy kill-switch: IDEAL_HARNESS_TEAM_POLICY=off ignores the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-team-policy-'));
  try {
    mkdirSync(join(dir, '.ideal-harness'), { recursive: true });
    writeFileSync(teamPolicyPath(dir), JSON.stringify({ rules: [{ id: 't1', action: 'allow' }] }));
    const policy = loadTeamPolicy({ cwd: dir, env: { [TEAM_POLICY_ENV_VAR]: 'off' } });
    assert.equal(policy.rules.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTeamPolicy warns (not throws) on invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-team-policy-'));
  try {
    mkdirSync(join(dir, '.ideal-harness'), { recursive: true });
    writeFileSync(teamPolicyPath(dir), '{ not json');
    const policy = loadTeamPolicy({ cwd: dir, env: {} });
    assert.equal(policy.rules.length, 0);
    assert.match(policy.warnings[0] ?? '', /invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('composePolicyTiers: personal user policy outranks team policy outranks the default floor', () => {
  const user = parseUserPolicy(
    { rules: [{ id: 'u-allow', action: 'allow', tool: 'Bash', match: '^npm test' }] },
    'user.json',
  );
  const team = parseUserPolicy(
    { rules: [{ id: 't-ask', action: 'ask', tool: 'Bash', match: '^npm test' }] },
    'team.json',
  );
  const { tiers } = composePolicyTiers([
    { policy: user, label: 'user policy' },
    { policy: team, label: 'team policy' },
  ]);
  // The personal allow wins over the team's own ask rule for the same command.
  assert.equal(evaluateTiered({ tool: 'Bash', input: { command: 'npm test' } }, tiers).action, 'allow');
});

test('composePolicyTiers: team policy still beats the default floor when no personal rule matches', () => {
  const user = parseUserPolicy({}, 'user.json');
  const team = parseUserPolicy(
    { rules: [{ id: 't-allow', action: 'allow', tool: 'Bash', match: '^corepack pnpm (test|build)\\b' }] },
    'team.json',
  );
  const { tiers } = composePolicyTiers([
    { policy: user, label: 'user policy' },
    { policy: team, label: 'team policy' },
  ]);
  assert.equal(evaluateTiered({ tool: 'Bash', input: { command: 'corepack pnpm test' } }, tiers).action, 'allow');
  assert.equal(evaluateTiered({ tool: 'Bash', input: { command: 'rm -rf ~/' } }, tiers).action, 'deny');
});

test('composePolicyTiers labels which source disabled a default rule', () => {
  const user = parseUserPolicy({}, 'user.json');
  const team = parseUserPolicy({ disable: ['deny-read-credentials'] }, 'team.json');
  const { warnings } = composePolicyTiers([
    { policy: user, label: 'user policy' },
    { policy: team, label: 'team policy' },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /disabled by team policy/);
});

test('the user AND team policy files stay covered by self-policy protection', () => {
  for (const path of [
    '/repo/ideal-harness.policy.json',
    '/home/u/.config/ideal-harness.policy.json',
    '/repo/.ideal-harness/team-policy.json',
    '/repo/.ideal-harness/leases.json',
  ]) {
    for (const tool of ['Edit', 'Write']) {
      assert.equal(
        evaluate({ tool, input: { file_path: path } }, DEFAULT_RULES).action,
        'deny',
        `${tool} ${path} should be denied`,
      );
    }
  }
});
