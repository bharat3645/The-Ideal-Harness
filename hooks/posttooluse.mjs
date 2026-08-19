#!/usr/bin/env node

/**
 * PostToolUse hook — scrub every tool result below the model.
 *
 * Redacts secrets and fences untrusted/injected content by REWRITING the
 * result via the `updatedToolOutput` contract, so the model reads the scrubbed
 * version, not the raw one. Also emits an audit note via `additionalContext`
 * (which still fires on hosts that predate output rewriting). Fails open
 * (silent, original output preserved) on any error — a broken scrubber must
 * never block a tool result.
 *
 * After scrubbing, also auto-compresses large results via the same
 * `compressToolResult` engine `ideal-harness-compress`'s MCP tool already
 * exposes manually (issue #3). Compression runs on the ALREADY-redacted
 * text, never the raw one, so a secret can never survive into a compressed
 * sample. **Not CCR-recoverable**: `compressToolResult(text)` is called here
 * without a `CcrStore`, deliberately — a hook script is a fresh Node process
 * on every single tool call, so any store built here would be garbage
 * collected before the `compress` MCP server's own `ccr_retrieve` tool
 * (a different, long-lived process) could ever see it. Making this
 * recoverable would mean disk-backing CCR, which `decisions.md` D035
 * rejected on purpose. If recoverability matters for a given call, use the
 * `compress` MCP tool directly instead — it holds a real, live `CcrStore`.
 * Kill switch: `IDEAL_HARNESS_AUTO_COMPRESS=off` (redaction/fencing above
 * are unaffected).
 *
 * Also runs the two Design & Taste checks — see `src/guard/design.ts`: the
 * opt-in hex-color-vs-token-file check, and the on-by-default (kill switch
 * `IDEAL_HARNESS_DESIGN_LINT=off`) reduced-motion accessibility check. Both
 * are advisory only, exactly like the secret/injection warnings above them:
 * PostToolUse has no permission-decision contract to block with, only
 * `additionalContext` to surface a note the model reads. A finding here is
 * a flag, not a floor.
 */

import { compressToolResult } from '../dist/compress/index.js';
import { checkDesignTokens, checkReducedMotion, scrubToolOutput } from '../dist/guard/index.js';

function designLintWarnings(tool, input) {
  if (tool !== 'Edit' && tool !== 'Write') {
    return [];
  }
  const filePath = input?.file_path ?? input?.path ?? '';
  const newContent = tool === 'Edit' ? (input?.new_string ?? '') : (input?.content ?? '');
  if (!filePath || !newContent) {
    return [];
  }
  const warnings = [];
  try {
    const tokens = checkDesignTokens(filePath, newContent);
    if (tokens.checked && tokens.unknownHexColors.length > 0) {
      warnings.push(
        `design-lint: ${tokens.unknownHexColors.length} hex color(s) not in the configured design-token file [${tokens.unknownHexColors.join(', ')}] — see IDEAL_HARNESS_DESIGN_TOKENS_FILE`,
      );
    }
  } catch {
    // fail open — a broken lint must never block or crash the hook
  }
  try {
    const motion = checkReducedMotion(filePath, newContent);
    if (motion.checked && motion.flagged) {
      warnings.push(
        'design-lint: new animation/transition with no prefers-reduced-motion in this edit — verify it is handled globally, or add one here (see skills/motion-design)',
      );
    }
  } catch {
    // fail open
  }
  return warnings;
}

/** Compress already-scrubbed text, never the raw one. Fails open: any error leaves output untouched. */
function autoCompress(text) {
  if (process.env.IDEAL_HARNESS_AUTO_COMPRESS?.trim().toLowerCase() === 'off') {
    return null;
  }
  try {
    const result = compressToolResult(text);
    return result.method === 'none' ? null : result;
  } catch {
    return null;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const event = JSON.parse(await readStdin());
  const tool = event.tool_name ?? event.toolName ?? undefined;
  const input = event.tool_input ?? event.toolInput ?? {};
  const raw = event.tool_response;

  // Only rewrite string outputs; structured results are scanned but left intact
  // so we never mangle a tool's JSON shape.
  const isString = typeof raw === 'string';
  const text = isString ? raw : JSON.stringify(raw ?? '');

  const { output, changed, warnings } = scrubToolOutput(text, { tool });
  const allWarnings = [...warnings, ...designLintWarnings(tool, input)];

  // Compress the scrubbed (redacted/fenced) text, not the raw one — a secret
  // must never survive into a compressed sample.
  const compression = isString ? autoCompress(output) : null;
  const finalOutput = compression !== null ? compression.text : output;
  if (compression !== null) {
    allWarnings.push(
      `auto-compressed via ${compression.method} (${compression.originalTokens} -> ${compression.compressedTokens} tokens, not CCR-recoverable from this hook — see module doc)`,
    );
  }

  const hookSpecificOutput = { hookEventName: 'PostToolUse' };
  if ((changed || compression !== null) && isString) {
    hookSpecificOutput.updatedToolOutput = finalOutput;
  }
  if (allWarnings.length > 0) {
    hookSpecificOutput.additionalContext = allWarnings.map((w) => `WARNING: ${w}`).join('\n');
  }

  if (!hookSpecificOutput.updatedToolOutput && !hookSpecificOutput.additionalContext) {
    process.stdout.write('{}');
    return;
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

main().catch(() => {
  process.stdout.write('{}');
});
