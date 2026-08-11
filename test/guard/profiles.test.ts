import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROFILE_ENV_VAR, PROFILES, resolveProfile } from '../../src/guard/profiles.js';

test('resolveProfile defaults to "default" when unset or empty', () => {
  assert.equal(resolveProfile({}).name, 'default');
  assert.equal(resolveProfile({ [PROFILE_ENV_VAR]: '' }).name, 'default');
  assert.equal(resolveProfile({ [PROFILE_ENV_VAR]: '   ' }).name, 'default');
});

test('resolveProfile reads strict/default/fast, case/space-insensitively', () => {
  assert.equal(resolveProfile({ [PROFILE_ENV_VAR]: 'strict' }).name, 'strict');
  assert.equal(resolveProfile({ [PROFILE_ENV_VAR]: ' FAST ' }).name, 'fast');
  assert.equal(resolveProfile({ [PROFILE_ENV_VAR]: 'Default' }).name, 'default');
});

test('resolveProfile: an unrecognized name fails strict, never soft', () => {
  assert.equal(resolveProfile({ [PROFILE_ENV_VAR]: 'yolo' }).name, 'strict');
});

test('every profile only selects the existing floorMode knob (no invented mechanism)', () => {
  assert.equal(PROFILES.strict.floorMode, 'enforce');
  assert.equal(PROFILES.default.floorMode, 'soft');
  assert.equal(PROFILES.fast.floorMode, 'soft');
});
