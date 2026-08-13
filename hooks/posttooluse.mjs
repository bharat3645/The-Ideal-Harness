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
 * Also runs the two Design & Taste checks — see `src/guard/design.ts`: the
 * opt-in hex-color-vs-token-file check, and the on-by-default (kill switch
 * `IDEAL_HARNESS_DESIGN_LINT=off`) reduced-motion accessibility check. Both
 * are advisory only, exactly like the secret/injection warnings above them:
 * PostToolUse has no permission-decision contract to block with, only
 * `additionalContext` to surface a note the model reads. A finding here is
 * a flag, not a floor.
 */

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

  const hookSpecificOutput = { hookEventName: 'PostToolUse' };
  if (changed && isString) {
    hookSpecificOutput.updatedToolOutput = output;
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
