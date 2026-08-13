import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  checkDesignTokens,
  checkReducedMotion,
  DESIGN_LINT_ENV_VAR,
  DESIGN_TOKENS_FILE_ENV_VAR,
  extractKnownHexTokens,
  lintHexColors,
  lintReducedMotion,
} from '../../src/guard/design.js';

test('extractKnownHexTokens finds every distinct hex literal, normalized lowercase', () => {
  const css = ':root { --brand: #14736B; --slate: #14736b; --glow: #FFF; }';
  const tokens = extractKnownHexTokens(css);
  assert.deepEqual([...tokens].sort(), ['#14736b', '#fff']);
});

test('lintHexColors: checked=false for a file type it does not cover', () => {
  const result = lintHexColors('a.java', 'String color = "#ABCDEF";', new Set(['#123456']));
  assert.equal(result.checked, false);
  assert.deepEqual(result.unknownHexColors, []);
});

test('lintHexColors: checked=false when no token set is available (unconfigured, not a violation)', () => {
  const result = lintHexColors('a.tsx', 'const c = "#ABCDEF";', null);
  assert.equal(result.checked, false);
  assert.deepEqual(result.unknownHexColors, []);
});

test('lintHexColors: flags a hex color absent from the known token set', () => {
  const result = lintHexColors('a.tsx', 'const c = "#ABCDEF";', new Set(['#123456']));
  assert.equal(result.checked, true);
  assert.deepEqual(result.unknownHexColors, ['#abcdef']);
});

test('lintHexColors: an approved token produces no findings', () => {
  const result = lintHexColors('a.css', '.x { color: #14736B; }', new Set(['#14736b']));
  assert.equal(result.checked, true);
  assert.deepEqual(result.unknownHexColors, []);
});

test('lintHexColors: dedupes repeated unknown colors', () => {
  const result = lintHexColors('a.tsx', 'a: "#ABCDEF"; b: "#abcdef"; c: "#ABCDEF";', new Set());
  assert.deepEqual(result.unknownHexColors, ['#abcdef']);
});

test('checkDesignTokens: no-op (checked=false) when the env var is unset — not configured, not a violation', () => {
  const result = checkDesignTokens('a.tsx', 'const c = "#ABCDEF";', { env: {} });
  assert.equal(result.checked, false);
});

test('checkDesignTokens: fails open when the configured token file does not exist', () => {
  const result = checkDesignTokens('a.tsx', 'const c = "#ABCDEF";', {
    env: { [DESIGN_TOKENS_FILE_ENV_VAR]: 'does-not-exist.css' },
    cwd: tmpdir(),
  });
  assert.equal(result.checked, false);
});

test('checkDesignTokens: reads a real token file (relative to cwd) and flags an unknown color', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-design-'));
  try {
    writeFileSync(join(dir, 'tokens.css'), ':root { --brand: #14736B; }', 'utf8');
    const result = checkDesignTokens('Widget.tsx', 'style={{ color: "#ABCDEF" }}', {
      env: { [DESIGN_TOKENS_FILE_ENV_VAR]: 'tokens.css' },
      cwd: dir,
    });
    assert.equal(result.checked, true);
    assert.deepEqual(result.unknownHexColors, ['#abcdef']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkDesignTokens: an approved color from the real token file passes clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-design-'));
  try {
    writeFileSync(join(dir, 'tokens.css'), ':root { --brand: #14736B; }', 'utf8');
    const result = checkDesignTokens('Widget.tsx', 'style={{ color: "#14736B" }}', {
      env: { [DESIGN_TOKENS_FILE_ENV_VAR]: 'tokens.css' },
      cwd: dir,
    });
    assert.equal(result.checked, true);
    assert.deepEqual(result.unknownHexColors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lintReducedMotion: checked=false for a file type it does not cover', () => {
  const result = lintReducedMotion('a.java', '@keyframes spin { from { transform: rotate(0); } }');
  assert.equal(result.checked, false);
  assert.equal(result.flagged, false);
});

test('lintReducedMotion: no animation introduced -> checked, not flagged', () => {
  const result = lintReducedMotion('a.css', '.x { color: red; padding: 8px; }');
  assert.equal(result.checked, true);
  assert.equal(result.flagged, false);
});

test('lintReducedMotion: flags a new @keyframes with no reduced-motion accommodation', () => {
  const result = lintReducedMotion('a.css', '@keyframes spin { from { transform: rotate(0); } }');
  assert.equal(result.checked, true);
  assert.equal(result.flagged, true);
});

test('lintReducedMotion: flags a transition with a duration and no accommodation', () => {
  const result = lintReducedMotion('Widget.tsx', 'style={{ transition: "opacity 300ms ease" }}');
  assert.equal(result.checked, true);
  assert.equal(result.flagged, true);
});

test('lintReducedMotion: does not flag when prefers-reduced-motion is present in the same edit', () => {
  const css = `
    @keyframes spin { from { transform: rotate(0); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  `;
  const result = lintReducedMotion('a.css', css);
  assert.equal(result.checked, true);
  assert.equal(result.flagged, false);
});

test('checkReducedMotion: on by default (no env needed, unlike the token check)', () => {
  const result = checkReducedMotion('a.css', '@keyframes spin { from { transform: rotate(0); } }', { env: {} });
  assert.equal(result.checked, true);
  assert.equal(result.flagged, true);
});

test('checkReducedMotion: kill switch disables it', () => {
  const result = checkReducedMotion('a.css', '@keyframes spin { from { transform: rotate(0); } }', {
    env: { [DESIGN_LINT_ENV_VAR]: 'off' },
  });
  assert.equal(result.checked, false);
  assert.equal(result.flagged, false);
});
