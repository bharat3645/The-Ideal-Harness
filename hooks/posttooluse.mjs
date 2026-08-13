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
 * Also runs the (opt-in, off by default) Design & Taste hex-color check —
 * see `src/guard/design.ts`. This is advisory only, exactly like the secret
 * / injection warnings above it: PostToolUse has no permission-decision
 * contract to block with, only `additionalContext` to surface a note the
 * model reads. A finding here is a flag, not a floor.
 */

import { checkDesignTokens, scrubToolOutput } from '../dist/guard/index.js';

function designLintWarning(tool, input) {
  if (tool !== 'Edit' && tool !== 'Write') {
    return null;
  }
  const filePath = input?.file_path ?? input?.path ?? '';
  const newContent = tool === 'Edit' ? (input?.new_string ?? '') : (input?.content ?? '');
  if (!filePath || !newContent) {
    return null;
  }
  try {
    const result = checkDesignTokens(filePath, newContent);
    if (result.checked && result.unknownHexColors.length > 0) {
      return `design-lint: ${result.unknownHexColors.length} hex color(s) not in the configured design-token file [${result.unknownHexColors.join(', ')}] — see IDEAL_HARNESS_DESIGN_TOKENS_FILE`;
    }
  } catch {
    // fail open — a broken lint must never block or crash the hook
  }
  return null;
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
  const designWarning = designLintWarning(tool, input);
  const allWarnings = designWarning ? [...warnings, designWarning] : warnings;

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
