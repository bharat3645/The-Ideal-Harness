#!/usr/bin/env node
/**
 * PreToolUse hook — the automatic (Tier-1) enforcement gate.
 *
 * Evaluates every tool call against the deny-wins policy, blocks outbound
 * secrets, and flags injection cues. Fails CLOSED to manual approval ('ask')
 * on any internal error — a broken gate must never silently allow.
 */

import {
  DEFAULT_RULES,
  evaluate,
  looksLikeInjection,
  redactSecrets,
  skipPermissionsActive,
} from '../dist/guard/index.js';

const EGRESS_TOOLS = new Set(['Bash', 'WebFetch', 'Write', 'Edit', 'NotebookEdit']);

function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  const event = JSON.parse(raw);
  const tool = event.tool_name ?? event.toolName ?? '';
  const input = event.tool_input ?? event.toolInput ?? {};

  // Human opt-out: `claude --dangerously-skip-permissions` (event.permission_mode ===
  // 'bypassPermissions') or the IDEAL_HARNESS_DANGEROUSLY_SKIP_PERMISSIONS env var.
  // The model can never reach this branch on its own — only the operator can set
  // either signal. When active, the permission gate is fully waived (allow-all);
  // PostToolUse output scrubbing is unaffected. Loud on stderr, by design.
  if (skipPermissionsActive({ permissionMode: event.permission_mode ?? event.permissionMode })) {
    process.stderr.write(
      `[ideal-harness] ⚠ permission floor BYPASSED (dangerously-skip-permissions) — allowing ${tool || 'tool'}\n`,
    );
    emit('allow', 'dangerously-skip-permissions active: harness permission floor waived by operator');
    return;
  }

  const decision = evaluate({ tool, input }, DEFAULT_RULES);

  // Block outbound secrets regardless of the base decision.
  if (EGRESS_TOOLS.has(tool)) {
    const { count, types } = redactSecrets(JSON.stringify(input));
    if (count > 0) {
      emit('deny', `blocked: outbound call contains ${count} secret(s) [${types.join(', ')}]`);
      return;
    }
  }

  // Escalate on injection cues in the request.
  if (decision.action === 'allow' && looksLikeInjection(JSON.stringify(input))) {
    emit('ask', 'injection cue detected in tool input; manual review');
    return;
  }

  emit(decision.action, decision.reason);
}

main().catch((error) => {
  // Fail closed: on error, require manual approval rather than allowing.
  emit('ask', `guard error, failing closed to manual approval: ${error?.message ?? error}`);
});
