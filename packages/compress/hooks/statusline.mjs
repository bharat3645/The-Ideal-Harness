#!/usr/bin/env node
/**
 * statusLine command — the live context-window meter on Claude Code's bottom line.
 *
 * Prints a one-line readout (e.g. `IH 142k/1M 14% ⚠ consider /compact or /clear`): the tokens
 * the session has spent and the share of the model's full context window they
 * occupy. All the classification / formatting is the pure, tested logic in
 * src/budget.ts; this wrapper only does the messy I/O.
 *
 * The window is NOT hardcoded. Claude Code reports the active model's real context
 * window on stdin (`context_window.context_window_size` — 200k by default, 1M for
 * extended-context models), and we use it verbatim, so the meter adapts to whatever
 * model/window the agent is actually running. See:
 * https://code.claude.com/docs/en/statusline.md
 *
 * Window resolution (first match wins):
 *   1. IDEAL_HARNESS_BUDGET_WINDOW — explicit absolute override.
 *   2. context_window.context_window_size — the live window Claude Code reports.
 *   3. DEFAULT_WINDOW — last-resort fallback (hosts that don't report a window, e.g.
 *      Claude Code < 2.1.132).
 *
 * Tokens spent come from the same stdin payload when present
 * (`context_window.total_input_tokens` / `current_usage`, input side incl. cache),
 * falling back to scanning the transcript for the most recent turn's usage.
 *
 * It does NOT force `/compact` — Claude Code exposes no such hook. It only
 * measures and advises. FAILS OPEN: any error prints a neutral placeholder and
 * exits 0, because a broken statusline must never disrupt the session.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeBudget, DEFAULT_WINDOW, formatStatusline, resolveWindow } from '../dist/index.js';

const PLACEHOLDER = 'IH —';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The model's full context window, in tokens — never hardcoded to one model's size.
 * An explicit env override wins; otherwise we trust the live `context_window_size`
 * Claude Code reports for the active model (200k / 1M / etc.); only if neither is
 * present do we fall back to DEFAULT_WINDOW so the meter still renders.
 */
function resolveWindowFor(event) {
  const abs = Number.parseInt(process.env.IDEAL_HARNESS_BUDGET_WINDOW ?? '', 10);
  if (Number.isFinite(abs) && abs > 0) {
    return abs;
  }
  const reported = event?.context_window?.context_window_size;
  if (Number.isFinite(reported) && reported > 0) {
    return resolveWindow(reported);
  }
  return DEFAULT_WINDOW;
}

/**
 * Tokens spent, straight from Claude Code's own context accounting when present —
 * the input side of the latest API response (input + cache reads + cache writes),
 * matching `used_percentage`'s input-only formula. `current_usage` is null before
 * the first call and right after `/compact`, so fall back to `total_input_tokens`.
 * Returns null when the payload carries no usage (older hosts → transcript scan).
 */
function tokensFromEvent(event) {
  const cw = event?.context_window;
  if (!cw || typeof cw !== 'object') {
    return null;
  }
  const u = cw.current_usage;
  if (u && typeof u === 'object') {
    const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (used > 0) {
      return used;
    }
  }
  if (Number.isFinite(cw.total_input_tokens) && cw.total_input_tokens > 0) {
    return cw.total_input_tokens;
  }
  return null;
}

/**
 * Current context occupancy = the input side of the most recent assistant turn
 * (input + cache-read + cache-creation), i.e. everything the model was handed.
 * Scans the JSONL transcript from the end and stops at the first turn with usage.
 * This is the fallback for hosts that don't send a `context_window` payload.
 */
function tokensFromTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return null;
  }
  const lines = readFileSync(transcriptPath, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const u = obj?.message?.usage ?? obj?.usage;
    if (u && typeof u === 'object') {
      const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      if (used > 0) {
        return used;
      }
    }
  }
  return null;
}

/**
 * Per-session fill-rate state in the OS temp dir. Returns the previous total to
 * compare against, and only advances the stored total on a genuinely new reading
 * so the "filling fast" flag stays stable across re-renders of the same turn.
 */
function fillRate(sessionId, current) {
  const safeId = String(sessionId ?? 'default').replace(/[^a-z0-9_-]/gi, '');
  const statePath = join(tmpdir(), `ideal-harness-budget-${safeId}.json`);
  let prev = null;
  try {
    if (existsSync(statePath)) {
      const saved = JSON.parse(readFileSync(statePath, 'utf8'));
      if (saved && current === saved.tokens) {
        // Same turn, just re-rendering: keep the delta from the last real change.
        return saved.previousTokens ?? null;
      }
      prev = saved?.tokens ?? null;
    }
  } catch {
    prev = null;
  }
  try {
    writeFileSync(statePath, JSON.stringify({ tokens: current, previousTokens: prev }));
  } catch {
    // A read-only temp dir is not fatal — we just lose fill-rate this render.
  }
  return prev;
}

async function main() {
  let event = {};
  try {
    event = JSON.parse(await readStdin());
  } catch {
    process.stdout.write(PLACEHOLDER);
    return;
  }

  // Prefer Claude Code's own accounting; fall back to scanning the transcript.
  const tokens = tokensFromEvent(event) ?? tokensFromTranscript(event.transcript_path ?? event.transcriptPath);
  if (tokens == null) {
    // No assistant turn with usage yet — show a neutral line, never a fabricated number.
    process.stdout.write(PLACEHOLDER);
    return;
  }

  const window = resolveWindowFor(event);
  const previousTokens = fillRate(event.session_id ?? event.sessionId, tokens);
  const analysis = analyzeBudget({ tokens, window, previousTokens });
  process.stdout.write(formatStatusline(analysis, { model: event.model?.id ?? event.model }));
}

main().catch(() => {
  // Fail open: a broken statusline must never break the session.
  process.stdout.write(PLACEHOLDER);
});
