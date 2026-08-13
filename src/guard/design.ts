/**
 * Design & Taste — deliberately narrow, two deterministic rules.
 *
 * `DESIGN.md` rates `pbakaus/impeccable` a spine-level source ("the only
 * design tool with enforcement below the LLM") but the full ambition (a
 * reflex-reject catalog, a two-altitude slop test, per-model defect blocks)
 * needs a human-decided rule set before it's anything but a guess. This
 * ships exactly two mechanical rules instead of that full catalog — no
 * taste judgment, no LLM in the loop, same honesty-by-construction standard
 * as every other tier in this module:
 *
 *   1. `checkDesignTokens` — a hex color literal introduced into a UI/style
 *      file that isn't already present in the project's own design-token
 *      file. Opt-in via `IDEAL_HARNESS_DESIGN_TOKENS_FILE`: unconfigured
 *      means "nothing to compare against," a silent no-op, never a guess.
 *   2. `checkReducedMotion` — a new CSS animation/transition introduced
 *      without a `prefers-reduced-motion` accommodation in the same edit,
 *      grounded in `skills/motion-design/SKILL.md`'s "not optional, no
 *      exceptions" accessibility rule (itself adapted from
 *      `kylezantos/design-motion-principles`, MIT). On by default (kill
 *      switch: `IDEAL_HARNESS_DESIGN_LINT=off`) since it needs no operator
 *      configuration to be meaningful — but stated honestly as a per-edit
 *      check: it cannot see a global stylesheet's reduced-motion handling
 *      elsewhere in the project, so its warning says "verify," not
 *      "violation."
 *
 * Everything genuinely taste-based (which lens leads, whether a duration
 * fits its context) stays in `motion-design`/`design-critique` as
 * model-cooperative judgment — this file only ever encodes what's actually
 * checkable by pattern match.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** File extensions this check looks at — UI/style surfaces only. */
export const DESIGN_LINT_EXTENSIONS = /\.(tsx|jsx|css|scss|less)$/i;

export const DESIGN_TOKENS_FILE_ENV_VAR = 'IDEAL_HARNESS_DESIGN_TOKENS_FILE';

/** Kill switch for `checkReducedMotion` (the only design-lint rule that's on by default). */
export const DESIGN_LINT_ENV_VAR = 'IDEAL_HARNESS_DESIGN_LINT';

const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;

const ANIMATION_INTRODUCED_RE = /@keyframes\b|animation(-duration)?\s*:|transition(-duration)?\s*:\s*[^;]*\d+m?s/i;
const REDUCED_MOTION_RE = /prefers-reduced-motion/i;

/** Every distinct hex color literal in a token file's content, normalized lowercase. */
export function extractKnownHexTokens(tokenFileContent: string): ReadonlySet<string> {
  const found = tokenFileContent.match(HEX_COLOR_RE) ?? [];
  return new Set(found.map((h) => h.toLowerCase()));
}

export interface DesignLintResult {
  /** False when the file type isn't covered or no token set was available — not itself a finding. */
  readonly checked: boolean;
  readonly unknownHexColors: readonly string[];
}

/** Pure check: does `content` (written to a file at `filePath`) use a hex color absent from `knownTokens`? */
export function lintHexColors(
  filePath: string,
  content: string,
  knownTokens: ReadonlySet<string> | null,
): DesignLintResult {
  if (knownTokens === null || !DESIGN_LINT_EXTENSIONS.test(filePath)) {
    return { checked: false, unknownHexColors: [] };
  }
  const found = content.match(HEX_COLOR_RE) ?? [];
  const unknownHexColors = [...new Set(found.map((h) => h.toLowerCase()))].filter((h) => !knownTokens.has(h));
  return { checked: true, unknownHexColors };
}

export interface CheckDesignTokensOptions {
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
}

/**
 * Hook-facing entry point: resolves the operator-configured token file,
 * reads it, and lints `content`. Fails open (returns `checked: false`) on
 * any I/O error or when unconfigured — the same fail-open contract
 * `appendJournalEntry` and `scrubToolOutput` already honor.
 */
export function checkDesignTokens(
  filePath: string,
  content: string,
  options: CheckDesignTokensOptions = {},
): DesignLintResult {
  const { env = process.env, cwd = process.cwd() } = options;
  const tokensFile = env[DESIGN_TOKENS_FILE_ENV_VAR]?.trim();
  if (!tokensFile) {
    return { checked: false, unknownHexColors: [] };
  }
  try {
    const path = isAbsolute(tokensFile) ? tokensFile : join(cwd, tokensFile);
    const tokenContent = readFileSync(path, 'utf8');
    return lintHexColors(filePath, content, extractKnownHexTokens(tokenContent));
  } catch {
    return { checked: false, unknownHexColors: [] };
  }
}

export interface ReducedMotionLintResult {
  readonly checked: boolean;
  readonly flagged: boolean;
}

/**
 * Pure check: does `content` introduce a new CSS animation/transition
 * without also including a `prefers-reduced-motion` accommodation in the
 * same content? A per-edit heuristic, not a project-wide guarantee — see
 * the module header for why that's a stated limitation, not an oversight.
 */
export function lintReducedMotion(filePath: string, content: string): ReducedMotionLintResult {
  if (!DESIGN_LINT_EXTENSIONS.test(filePath)) {
    return { checked: false, flagged: false };
  }
  if (!ANIMATION_INTRODUCED_RE.test(content)) {
    return { checked: true, flagged: false };
  }
  return { checked: true, flagged: !REDUCED_MOTION_RE.test(content) };
}

export interface CheckReducedMotionOptions {
  readonly env?: Record<string, string | undefined>;
}

/** Hook-facing entry point for `lintReducedMotion`, gated by the `DESIGN_LINT_ENV_VAR` kill switch. */
export function checkReducedMotion(
  filePath: string,
  content: string,
  options: CheckReducedMotionOptions = {},
): ReducedMotionLintResult {
  const { env = process.env } = options;
  if (env[DESIGN_LINT_ENV_VAR]?.trim().toLowerCase() === 'off') {
    return { checked: false, flagged: false };
  }
  return lintReducedMotion(filePath, content);
}
