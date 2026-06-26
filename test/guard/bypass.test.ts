import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BYPASS_ENV_VAR, BYPASS_PERMISSION_MODE, skipPermissionsActive } from '../../src/guard/bypass.js';

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
