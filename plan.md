# Plan — Context-window statusline + quality advisory

> A live token-budget readout for The Ideal Harness. It shows the tokens the current session has
> spent and the share of the model's **total context window** they occupy, on Claude Code's bottom
> statusline, and advises `/compact` or `/clear` before quality degrades.
>
> **Revised (v0.1.x):** the meter now measures usage against the **full context window** (`IH
> 142k/1M 14%`) instead of a soft 200k sub-ceiling, and advises near the 14% / 17% band. The
> earlier ceiling/fraction framing below is kept for history; the live facts are updated in place.
>
> The three phases below are **independently implementable**. Phase 1 is pure, tested logic with
> no I/O — useful on its own (and via the `compress` MCP server / CLI). Phase 2 wires it to a
> live statusline. Phase 3 makes the wiring reproducible across installs. Pick the phases that
> fit your use case.

## Why

The brief: (1) display live token usage at the bottom of the screen as a share of the model's
total context window, (2) advise the user to `/compact` or `/clear` once that share crosses a
quality-preserving band (~14% / 17%) or climbs fast — so work stays in the high-signal zone.

**Honest boundary (this project's brand):** Claude Code exposes **no hook or API to force
`/compact` mid-session.** Native auto-compact only fires near the *hard* context limit, not at a
quality-preserving soft threshold. So the harness does **not** auto-run `/compact`. Instead it
treats the advisory band as a **soft** line, **displays** live usage as a percentage of the full
window, and **advises** compaction once usage crosses it or climbs fast. Native auto-compact remains
the hard-limit backstop; the `compress` module already shrinks tool results to slow the fill.

## Decisions (locked)

| Decision | Value |
|---|---|
| Percentage basis | **Tokens spent ÷ the model's full context window**, read live (not hardcoded). `IH 142k/1M 14%`. |
| Window source | `IDEAL_HARNESS_BUDGET_WINDOW` (explicit override) wins; else the live `context_window.context_window_size` Claude Code reports for the active model (200k / 1M / …); else `DEFAULT_WINDOW` (1M) as a last-resort fallback. |
| Advisory thresholds | window-relative: **`warn` at 14%** (`⚠ consider /compact or /clear`), **`danger` at 17%** (`⚠ /compact or /clear for better results`). |
| Statusline content | **Minimal** — `IH <used>/<window> <pct>% <advisory>`. |
| Scope | **Display + advise only.** No hook alters the agent's own behavior. |

Home: the **`compress`** module — it already owns the token domain (`estimateTokens`, the token
gate in `packages/compress/src/tokens.ts`). One capability, one home; no new module.

---

## Phase 1 — Pure budget logic + tests  *(no I/O; standalone)*

**Status: implemented.**

New `packages/compress/src/budget.ts`, deterministic and side-effect-free:

- `resolveWindow(window) → number` — sanitizes the context-window size, falling back to
  `DEFAULT_WINDOW` on a non-finite/non-positive value so the denominator is never zero/NaN.
  (The model→window *lookup* lives in the Phase 2 hook, where the model id is available.)
- `analyzeBudget({ tokens, window?, previousTokens? }) → BudgetAnalysis`
  — `pct` (`tokens / window`), `zone` (`'ok' | 'warn' | 'danger'` at 0.14 / 0.17), `delta`, and
  `fillingFast` (`delta ≥ FAST_DELTA`, default 15k added in one turn).
- `formatStatusline(analysis, { model? }) → string` — the one-line readout, plus a
  `formatTokens` helper (`142000 → "142k"`, `1000000 → "1M"`).
- Exported constants: `DEFAULT_WINDOW` (1_000_000), `WARN_RATIO` (0.14), `DANGER_RATIO` (0.17),
  `FAST_DELTA` (15_000).

Re-exported from `packages/compress/src/index.ts`. Tests in
`packages/compress/test/budget.test.ts` (`node:test`): zone boundaries, `fillingFast` on/off,
absent `previousTokens`, `pct` rounding, `resolveWindow`, and `formatStatusline` snapshots.

**Use it standalone:** `import { analyzeBudget, formatStatusline } from '@ideal-harness/compress'`.

---

## Phase 2 — Statusline reader hook  *(thin I/O; fail-open)*

**Status: implemented.** Smoke-tested: below the band silent, warn shows `⚠ consider /compact or
/clear`, danger shows `⚠ /compact or /clear for better results`, fill-rate delta detected across readings
(`· filling fast`), bad input / missing transcript → `IH —`, and `IDEAL_HARNESS_BUDGET_WINDOW`
override honored.

New `packages/compress/hooks/statusline.mjs`, same shape as the guard hooks (imports the pure
functions from `../dist/index.js`):

1. Read the Claude Code statusLine JSON from stdin (`session_id`, `transcript_path`, `model`,
   `cost`).
2. Tokens spent: prefer Claude Code's own accounting on stdin
   (`context_window.current_usage` → `input_tokens + cache_read_input_tokens +
   cache_creation_input_tokens`, else `context_window.total_input_tokens`); fall back to
   scanning the transcript JSONL at `transcript_path` from the end for the last
   `message.usage`.
3. Fill-rate: read/write a per-session state file in `os.tmpdir()`
   (`ideal-harness-budget-<session_id>.json`) holding the previous total → pass as
   `previousTokens`, then store the new total.
4. Resolve `window`: `IDEAL_HARNESS_BUDGET_WINDOW` if set; else the live
   `context_window.context_window_size` Claude Code reports; else `DEFAULT_WINDOW` (1M).
   Sanitized via `resolveWindow(...)`.
5. Print `formatStatusline(...)`. **Fail open:** any error → print a minimal placeholder
   (`IH —`) and exit 0. A broken statusline must never break the session.

Smoke-test by piping a hand-made transcript line through the hook; run twice to see the
fill-rate delta.

---

## Phase 3 — Wiring + docs  *(reproducible install)*

**Status: implemented.** Live `.claude/settings.local.json` carries the `statusLine`; `scripts/setup.mjs`
writes `settings.statusLine` idempotently (fresh-write, re-run, and foreign-statusline-preserved all
verified); README + CLAUDE.md carry the honest display-only note.

- **Live (this checkout):** create/merge `.claude/settings.local.json` with a `statusLine`
  command pointing at the Phase 2 hook. `settings.local.json` is user-local and **not**
  floor-protected (the floor denies `settings.json` only), and Claude Code merges it natively.
- **Reproducible:** extend `scripts/setup.mjs` to also write `settings.statusLine` (pointing at
  `hookCmd('compress', 'statusline.mjs')`), set idempotently so a foreign statusline is never
  clobbered — consistent with the existing `replaceOurs` ethos.
- **Docs:** a short, honest note in `README.md` and `CLAUDE.md` — context-window statusline +
  advisory; explicitly **not** an auto-`/compact` (no such hook exists); the 14% / 17% band is a
  soft quality line, not the model's hard limit.

---

## Verification

| Step | Command |
|---|---|
| Build (topological) | `corepack pnpm -r run build` |
| Tests (130 across 5 packages) | `corepack pnpm -r run test` |
| Substrate self-validate | `corepack pnpm validate` |
| Lint/format | `corepack pnpm biome` |
| Phase 2 hook smoke test | pipe fake `{"transcript_path":…,"session_id":"t"}` into `node packages/compress/hooks/statusline.mjs` |
| Phase 3 live check | restart the session; confirm the bottom line shows `IH <used>/1M <pct>%`, advisory appears past 14% / 17% |
