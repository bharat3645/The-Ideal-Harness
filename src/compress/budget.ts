/**
 * Context-budget analysis — the window-usage meter.
 *
 * Pure, deterministic, I/O-free. Given the tokens a session is currently
 * occupying and the model's full context window, it reports how much of that
 * window is spent (as a percentage), whether it is filling fast, and whether the
 * session has crossed the advisory band where reasoning quality starts to slip.
 *
 * The percentage is measured against the model's **total context window**, not a
 * soft sub-ceiling — `IH 142k/1M 14%` means 142k tokens spent of a 1M window.
 * The advisory band (`WARN_RATIO` / `DANGER_RATIO`) is a *soft* quality line, not
 * the model's hard limit; well below it the model still has plenty of room, but
 * answers degrade as the window fills. The harness cannot force `/compact`
 * (Claude Code exposes no such hook); this module only measures and advises. The
 * model→window lookup and transcript reading live in the statusline hook, which
 * feeds resolved numbers into these functions.
 */

/**
 * Last-resort fallback window, used only when no real one is available. The hook
 * prefers the live `context_window.context_window_size` Claude Code reports for the
 * active model (200k / 1M / …), so this default is reached only on hosts that report
 * no window at all.
 */
export const DEFAULT_WINDOW = 1_000_000;
/** Gentle nudge once the session spends this fraction of the window → "consider /compact". */
export const WARN_RATIO = 0.14;
/** Strong advice once the session spends this fraction of the window → "/compact or /clear". */
export const DANGER_RATIO = 0.17;
/** "Filling fast" once a single turn adds this many tokens. */
export const FAST_DELTA = 15_000;

export type BudgetZone = 'ok' | 'warn' | 'danger';

export interface BudgetAnalysis {
  /** Tokens the session has spent (currently occupying the window). */
  readonly tokens: number;
  /** The model's full context window these tokens are measured against. */
  readonly window: number;
  /** tokens / window, clamped at 0 — the share of the context window spent. */
  readonly pct: number;
  /** ok < WARN_RATIO ≤ warn < DANGER_RATIO ≤ danger. */
  readonly zone: BudgetZone;
  /** Tokens added since the previous reading, or null when unknown. */
  readonly delta: number | null;
  /** delta ≥ FAST_DELTA. */
  readonly fillingFast: boolean;
}

/**
 * Sanitize a context-window size, falling back to DEFAULT_WINDOW so a bad model
 * lookup can never produce a zero or NaN denominator (which would make every
 * session read as 0% or NaN%).
 */
export function resolveWindow(window: number): number {
  return Number.isFinite(window) && window > 0 ? Math.round(window) : DEFAULT_WINDOW;
}

export interface AnalyzeBudgetInput {
  /** Tokens currently occupying the context window. */
  readonly tokens: number;
  /** The model's full context window (default DEFAULT_WINDOW). */
  readonly window?: number;
  /** Previous reading, to derive fill rate. Omit on the first reading. */
  readonly previousTokens?: number | null;
}

function zoneFor(pct: number): BudgetZone {
  if (pct >= DANGER_RATIO) {
    return 'danger';
  }
  if (pct >= WARN_RATIO) {
    return 'warn';
  }
  return 'ok';
}

/**
 * Classify the current budget. `tokens` and `window` are sanitized to
 * non-negative finite numbers; a non-positive window falls back to the default
 * so `pct` is always a real ratio of tokens-spent to the full window.
 */
export function analyzeBudget({
  tokens,
  window = DEFAULT_WINDOW,
  previousTokens = null,
}: AnalyzeBudgetInput): BudgetAnalysis {
  const used = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  const win = resolveWindow(window);
  const pct = used / win;
  const delta = previousTokens != null && Number.isFinite(previousTokens) ? used - previousTokens : null;
  return {
    tokens: used,
    window: win,
    pct,
    zone: zoneFor(pct),
    delta,
    fillingFast: delta != null && delta >= FAST_DELTA,
  };
}

/**
 * Render a token count compactly: 1_500_000 → "1.5M", 1_000_000 → "1M",
 * 142_000 → "142k", 1_500 → "1.5k", 900 → "900".
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 1000) {
    return String(Math.max(0, Math.round(n) || 0));
  }
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    // Drop a trailing ".0" so a 1M window reads "1M", not "1.0M".
    return m < 10 ? `${trimDecimal(m)}M` : `${Math.round(m)}M`;
  }
  const k = n / 1000;
  // One decimal under 10k (e.g. 1.5k), whole k above (e.g. 142k) to stay short.
  return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
}

/** "1.0" → "1", "1.5" → "1.5". Keeps one decimal only when it carries information. */
function trimDecimal(n: number): string {
  const fixed = n.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

const ADVISORY: Record<BudgetZone, string> = {
  ok: '',
  warn: '⚠ consider /compact or /clear',
  danger: '⚠ /compact or /clear for better results',
};

export interface FormatStatuslineOptions {
  /** Optional model label; reserved for richer renders (unused in minimal mode). */
  readonly model?: string;
}

/**
 * One-line statusline, e.g. `IH 142k/1M 14% ⚠ consider /compact or /clear · filling fast`.
 * Minimal by design: tokens spent and the share of the full context window first,
 * advisory only once the session crosses the soft quality band.
 */
export function formatStatusline(a: BudgetAnalysis, _opts: FormatStatuslineOptions = {}): string {
  const pctText = `${Math.round(a.pct * 100)}%`;
  const parts = [`IH ${formatTokens(a.tokens)}/${formatTokens(a.window)} ${pctText}`];
  const advisory = ADVISORY[a.zone];
  if (advisory) {
    parts.push(advisory);
  }
  if (a.fillingFast) {
    parts.push('· filling fast');
  }
  return parts.join(' ');
}
