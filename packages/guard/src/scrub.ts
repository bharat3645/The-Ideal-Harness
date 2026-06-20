/**
 * Tool-output scrubbing — the PostToolUse half of the always-on floor.
 *
 * Runs on every tool result. Two deterministic controls, both below the LLM:
 *  1. Secret redaction — rewrites the result so detected secrets are masked
 *     before the model ever reads them (not a post-hoc warning).
 *  2. Injection fencing — wraps untrusted external content (web fetches, or any
 *     output carrying injection cues) in a breakout-safe `<untrusted_content>`
 *     fence so the model treats it as data, not instructions.
 *
 * Returns the rewritten output plus whether anything changed, so the hook can
 * emit it via the PostToolUse `updatedToolOutput` contract. Pure + tested, so
 * the security behavior is not untested hook glue.
 */

import { looksLikeInjection, wrapUntrusted } from './injection.js';
import { redactSecrets } from './redact.js';

export interface ScrubResult {
  /** The output the model should see (redacted and/or fenced). */
  readonly output: string;
  /** True if `output` differs from the input — i.e. the hook should rewrite. */
  readonly changed: boolean;
  /** Human-readable audit notes for `additionalContext`. */
  readonly warnings: readonly string[];
}

/** Tools whose output is, by definition, untrusted external content. */
const EXTERNAL_CONTENT_TOOLS = new Set(['WebFetch', 'WebSearch']);

function isExternalContent(tool: string | undefined): boolean {
  if (!tool) return false;
  // MCP tool results are remote/third-party content; fence them too.
  return EXTERNAL_CONTENT_TOOLS.has(tool) || tool.startsWith('mcp__');
}

/**
 * Scrub a tool result. `tool` is the tool name (used to decide whether the
 * output is inherently untrusted). Secret redaction always runs; fencing runs
 * when the tool is an external-content tool or the output trips an injection cue.
 */
export function scrubToolOutput(response: string, opts: { tool?: string } = {}): ScrubResult {
  const warnings: string[] = [];

  const { text, count, types } = redactSecrets(response);
  let output = text;
  let changed = count > 0;
  if (count > 0) {
    warnings.push(
      `tool output contained ${count} secret(s) [${types.join(', ')}] — redacted before reaching the model.`,
    );
  }

  const injected = looksLikeInjection(output);
  if (injected || isExternalContent(opts.tool)) {
    output = wrapUntrusted(output, opts.tool ? { source: opts.tool } : {});
    changed = true;
    if (injected) {
      warnings.push('tool output contains prompt-injection cues — fenced as untrusted data.');
    }
  }

  return { output, changed, warnings };
}
