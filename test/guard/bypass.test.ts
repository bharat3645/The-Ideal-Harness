import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyFloorMode,
  BYPASS_ENV_VAR,
  BYPASS_PERMISSION_MODE,
  FLOOR_MODE_ENV_VAR,
  floorMode,
  skipPermissionsActive,
} from '../../src/guard/bypass.js';
import type { PolicyDecision } from '../../src/guard/policy/types.js';

test('off by default — empty env and no permission mode', () => {
  assert.equal(skipPermissionsActive({ env: {} }), false);
  assert.equal(skipPermissionsActive({ permissionMode: undefined, env: {} }), false);
});

test('normal Claude Code permission modes do NOT bypass', () => {
  for (const mode of ['default', 'acceptEdits', 'plan']) {
    assert.equal(skipPermissionsActive({ permissionMode: mode, env: {} }), false, `${mode} must not bypass`);
  }
});

test('bypassPermissions mode (claude --dangerously-skip-permissions) activates the skip', () => {
  assert.equal(skipPermissionsActive({ permissionMode: BYPASS_PERMISSION_MODE, env: {} }), true);
});

test('env var activates the skip on truthy values, case/space-insensitively', () => {
  for (const v of ['1', 'true', 'TRUE', ' yes ', 'on', 'On']) {
    assert.equal(skipPermissionsActive({ env: { [BYPASS_ENV_VAR]: v } }), true, `${JSON.stringify(v)} should activate`);
  }
});

test('env var stays off for falsy / unrelated values', () => {
  for (const v of ['', '0', 'false', 'no', 'off', 'maybe', 'enable']) {
    assert.equal(
      skipPermissionsActive({ env: { [BYPASS_ENV_VAR]: v } }),
      false,
      `${JSON.stringify(v)} should NOT activate`,
    );
  }
});

test('floorMode defaults to soft (softened for good); unset/empty → soft', () => {
  assert.equal(floorMode({ env: {} }), 'soft');
  assert.equal(floorMode({ env: { [FLOOR_MODE_ENV_VAR]: '' } }), 'soft');
});

test('floorMode: explicit but unrecognized value fails strict, to enforce', () => {
  for (const v of ['strict', 'off', 'yes', 'hard', 'sof t']) {
    assert.equal(floorMode({ env: { [FLOOR_MODE_ENV_VAR]: v } }), 'enforce', `${JSON.stringify(v)} must enforce`);
  }
});

test('floorMode reads enforce/soft/bypass from the env var, case/space-insensitively', () => {
  assert.equal(floorMode({ env: { [FLOOR_MODE_ENV_VAR]: 'enforce' } }), 'enforce');
  assert.equal(floorMode({ env: { [FLOOR_MODE_ENV_VAR]: 'soft' } }), 'soft');
  assert.equal(floorMode({ env: { [FLOOR_MODE_ENV_VAR]: ' SOFT ' } }), 'soft');
  assert.equal(floorMode({ env: { [FLOOR_MODE_ENV_VAR]: 'bypass' } }), 'bypass');
});

test('bypass signals win over the floor-mode env var', () => {
  assert.equal(floorMode({ permissionMode: BYPASS_PERMISSION_MODE, env: { [FLOOR_MODE_ENV_VAR]: 'soft' } }), 'bypass');
  assert.equal(floorMode({ env: { [BYPASS_ENV_VAR]: '1', [FLOOR_MODE_ENV_VAR]: 'soft' } }), 'bypass');
});

test('applyFloorMode: soft downgrades deny to ask, preserving the reason', () => {
  const deny: PolicyDecision = { action: 'deny', ruleId: 'deny-read-credentials', reason: 'credential read' };
  const softened = applyFloorMode(deny, 'soft');
  assert.equal(softened.action, 'ask');
  assert.equal(softened.ruleId, 'deny-read-credentials');
  assert.match(softened.reason, /credential read/);
});

test('applyFloorMode: soft leaves ask and allow untouched', () => {
  const ask: PolicyDecision = { action: 'ask', ruleId: 'ask-bash', reason: 'shell' };
  const allow: PolicyDecision = { action: 'allow', ruleId: 'allow-read', reason: 'read' };
  assert.deepEqual(applyFloorMode(ask, 'soft'), ask);
  assert.deepEqual(applyFloorMode(allow, 'soft'), allow);
});

test('applyFloorMode: enforce is identity; bypass allows everything', () => {
  const deny: PolicyDecision = { action: 'deny', ruleId: 'd', reason: 'r' };
  assert.deepEqual(applyFloorMode(deny, 'enforce'), deny);
  assert.equal(applyFloorMode(deny, 'bypass').action, 'allow');
  assert.equal(applyFloorMode({ action: 'ask', ruleId: 'a', reason: 'r' }, 'bypass').action, 'allow');
});
