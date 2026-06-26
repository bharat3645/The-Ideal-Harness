import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeBudget,
  DEFAULT_WINDOW,
  formatStatusline,
  formatTokens,
  resolveWindow,
} from '../../src/compress/budget.js';

test('resolveWindow: a valid window passes through, rounded', () => {
  assert.equal(resolveWindow(1_000_000), 1_000_000);
  assert.equal(resolveWindow(200_000), 200_000);
  assert.equal(resolveWindow(199_999.6), 200_000);
});

test('resolveWindow: a bad window falls back to the default window', () => {
  assert.equal(resolveWindow(0), DEFAULT_WINDOW);
  assert.equal(resolveWindow(Number.NaN), DEFAULT_WINDOW);
  assert.equal(resolveWindow(-5), DEFAULT_WINDOW);
});

test('analyzeBudget: pct is the share of the full window, zones at 14% / 17%', () => {
  const window = 1_000_000;
  assert.equal(analyzeBudget({ tokens: 100_000, window }).pct, 0.1);
  assert.equal(analyzeBudget({ tokens: 139_000, window }).zone, 'ok');
  assert.equal(analyzeBudget({ tokens: 140_000, window }).zone, 'warn'); // exactly 14%
  assert.equal(analyzeBudget({ tokens: 169_000, window }).zone, 'warn');
  assert.equal(analyzeBudget({ tokens: 170_000, window }).zone, 'danger'); // exactly 17%
  assert.equal(analyzeBudget({ tokens: 250_000, window }).zone, 'danger');
});

test('analyzeBudget: fill rate needs a previous reading', () => {
  const fast = analyzeBudget({ tokens: 140_000, previousTokens: 120_000 });
  assert.equal(fast.delta, 20_000);
  assert.equal(fast.fillingFast, true);

  const slow = analyzeBudget({ tokens: 140_000, previousTokens: 138_000 });
  assert.equal(slow.delta, 2_000);
  assert.equal(slow.fillingFast, false);

  const first = analyzeBudget({ tokens: 140_000 });
  assert.equal(first.delta, null);
  assert.equal(first.fillingFast, false);
});

test('analyzeBudget: garbage tokens/window are sanitized, never NaN', () => {
  const a = analyzeBudget({ tokens: Number.NaN, window: 0 });
  assert.equal(a.tokens, 0);
  assert.equal(a.window, DEFAULT_WINDOW);
  assert.equal(a.pct, 0);
  assert.equal(a.zone, 'ok');
});

test('formatTokens: compact across k and M scales', () => {
  assert.equal(formatTokens(142_000), '142k');
  assert.equal(formatTokens(1_500), '1.5k');
  assert.equal(formatTokens(900), '900');
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(1_000_000), '1M');
  assert.equal(formatTokens(1_500_000), '1.5M');
});

test('formatStatusline: below the band shows tokens + window share only, no advisory', () => {
  const line = formatStatusline(analyzeBudget({ tokens: 100_000, window: 1_000_000 }));
  assert.equal(line, 'IH 100k/1M 10%');
});

test('formatStatusline: warn and danger carry the right advisory near 14% / 17%', () => {
  assert.equal(
    formatStatusline(analyzeBudget({ tokens: 150_000, window: 1_000_000 })),
    'IH 150k/1M 15% ⚠ consider /compact or /clear',
  );
  assert.equal(
    formatStatusline(analyzeBudget({ tokens: 180_000, window: 1_000_000 })),
    'IH 180k/1M 18% ⚠ /compact or /clear for better results',
  );
});

test('formatStatusline: "filling fast" is appended when a turn adds a lot', () => {
  const line = formatStatusline(analyzeBudget({ tokens: 150_000, window: 1_000_000, previousTokens: 120_000 }));
  assert.equal(line, 'IH 150k/1M 15% ⚠ consider /compact or /clear · filling fast');
});
