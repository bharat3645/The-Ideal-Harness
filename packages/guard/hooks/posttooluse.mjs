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
 */

import { scrubToolOutput } from '../dist/index.js';

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
  const raw = event.tool_response;

  // Only rewrite string outputs; structured results are scanned but left intact
  // so we never mangle a tool's JSON shape.
  const isString = typeof raw === 'string';
  const text = isString ? raw : JSON.stringify(raw ?? '');

  const { output, changed, warnings } = scrubToolOutput(text, { tool });

  const hookSpecificOutput = { hookEventName: 'PostToolUse' };
  if (changed && isString) {
    hookSpecificOutput.updatedToolOutput = output;
  }
  if (warnings.length > 0) {
    hookSpecificOutput.additionalContext = warnings.map((w) => `WARNING: ${w}`).join('\n');
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
