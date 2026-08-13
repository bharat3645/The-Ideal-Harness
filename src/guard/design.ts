/**
 * Design & Taste — v1, deliberately narrow.
 *
 * `DESIGN.md` rates `pbakaus/impeccable` a spine-level source ("the only
 * design tool with enforcement below the LLM") but the full ambition (a
 * reflex-reject catalog, a two-altitude slop test, per-model defect blocks)
 * needs a human-decided rule set before it's anything but a guess. This
 * ships exactly one deterministic rule instead: flag a hex color literal
 * introduced into a UI/style file that isn't already present in the
 * project's own design-token file. No taste judgment, no LLM in the loop —
 * a plain set-membership check, same honesty-by-construction standard as
 * every other tier in this module.
 *
 * Off by default. `IDEAL_HARNESS_DESIGN_TOKENS_FILE` (a path to the
 * project's token source — e.g. a CSS file of `--token: #hex;`
 * declarations) opts a project in; unset means "not configured," and this
 * is a silent no-op — never a guess at what counts as a violation with
 * nothing to compare against. A missing/unreadable token file fails open
 * the same way: observability must never block a tool call.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** File extensions this check looks at — UI/style surfaces only. */
export const DESIGN_LINT_EXTENSIONS = /\.(tsx|jsx|css|scss|less)$/i;

export const DESIGN_TOKENS_FILE_ENV_VAR = 'IDEAL_HARNESS_DESIGN_TOKENS_FILE';

const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;

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
