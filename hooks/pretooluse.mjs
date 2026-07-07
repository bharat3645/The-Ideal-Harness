#!/usr/bin/env node
/**
 * PreToolUse hook — the automatic (Tier-1) enforcement gate.
 *
 * Evaluates every tool call against the deny-wins policy, blocks outbound
 * secrets, flags injection cues, and journals every decision. Fails CLOSED to
 * manual approval ('ask') on any internal error — a broken gate must never
 * silently allow.
 *
 * Operator knobs (all human-owned; the model can set none of them):
 *   - floor mode: soft (DEFAULT: deny → ask, the human decides) | enforce
 *     (hard denies, via IDEAL_HARNESS_FLOOR_MODE=enforce) | bypass (allow-all,
 *     via `claude --dangerously-skip-permissions` or the env vars). An
 *     unrecognized mode value fails strict, to enforce.
 *   - user policy: `ideal-harness.policy.json` (project root or ~/.config)
 *     adds a higher rule tier and can disable default rules by id. The file
 *     itself is covered by the self-policy deny, so only the human edits it.
 *   - journal: every decision lands in .ideal-harness/guard-journal.jsonl
 *     (secret-redacted, fail-open; IDEAL_HARNESS_JOURNAL=off to disable).
 *     `ideal-harness-guard learn` reads it to PROPOSE allowlist entries.
 */

import {
  appendJournalEntry,
  applyFloorMode,
  buildJournalEntry,
  composePolicy,
  DEFAULT_RULES,
  evaluateTiered,
  FLOOR_MODE_ENV_VAR,
  floorMode,
  loadUserPolicy,
  looksLikeInjection,
  redactSecrets,
  subjectFor,
} from '../dist/guard/index.js';

const EGRESS_TOOLS = new Set(['Bash', 'WebFetch', 'Write', 'Edit', 'NotebookEdit']);

const KNOB_HINT = 'operator knobs: IDEAL_HARNESS_FLOOR_MODE=soft|bypass, or ideal-harness.policy.json';

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

function warn(message) {
  process.stderr.write(`[ideal-harness] ${message}\n`);
}

function journal(tool, subject, decision, mode, softened) {
  appendJournalEntry(buildJournalEntry({ ts: new Date().toISOString(), tool, subject, decision, mode, softened }));
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
  const subject = subjectFor({ tool, input });

  // Operator floor mode. Only the human can set these signals — the model
  // never reaches this branch by reasoning. Loud on stderr, by design.
  const rawMode = process.env[FLOOR_MODE_ENV_VAR]?.trim().toLowerCase();
  if (rawMode !== undefined && rawMode !== '' && !['enforce', 'soft', 'bypass'].includes(rawMode)) {
    warn(`⚠ unrecognized ${FLOOR_MODE_ENV_VAR}="${rawMode}" — failing strict to enforce`);
  }
  const mode = floorMode({ permissionMode: event.permission_mode ?? event.permissionMode });
  if (mode === 'bypass') {
    warn(`⚠ permission floor BYPASSED (dangerously-skip-permissions) — allowing ${tool || 'tool'}`);
    const decision = {
      action: 'allow',
      ruleId: 'bypass',
      reason: 'dangerously-skip-permissions active: harness permission floor waived by operator',
    };
    journal(tool, subject, decision, mode);
    emit(decision.action, decision.reason);
    return;
  }

  // Compose tiers: user policy overrides (if any) above the default floor.
  // Any loader problem falls back to the pristine defaults — a broken user
  // policy must never widen or silently narrow the floor.
  let tiers = [DEFAULT_RULES];
  try {
    const user = loadUserPolicy();
    const composed = composePolicy(user);
    for (const message of [...user.warnings, ...composed.warnings]) {
      warn(`policy: ${message}`);
    }
    tiers = composed.tiers;
  } catch (error) {
    warn(`policy: user policy load failed (${error?.message ?? error}); using default floor`);
  }

  let decision = evaluateTiered({ tool, input }, tiers);

  // Block outbound secrets regardless of the base decision.
  if (EGRESS_TOOLS.has(tool)) {
    const { count, types } = redactSecrets(JSON.stringify(input));
    if (count > 0) {
      decision = {
        action: 'deny',
        ruleId: 'egress-secrets',
        reason: `blocked: outbound call contains ${count} secret(s) [${types.join(', ')}]`,
      };
    }
  }

  // Apply the floor mode. Soft (the default) downgrades denies to asks, loudly.
  const applied = applyFloorMode(decision, mode);
  const softened = applied.action !== decision.action;
  if (softened) {
    warn(`⚠ soft floor: "${decision.ruleId}" deny downgraded to ask for ${tool || 'tool'}`);
  }

  // Explain-mode: a hard deny always names its rule and the knobs that could
  // change it — the floor teaches, it doesn't stonewall.
  let reason = applied.reason;
  if (applied.action === 'deny') {
    reason = `${reason} [rule=${applied.ruleId}; ${KNOB_HINT}]`;
  }

  // Escalate on injection cues in the request.
  if (applied.action === 'allow' && looksLikeInjection(JSON.stringify(input))) {
    const escalated = {
      action: 'ask',
      ruleId: 'injection-cue',
      reason: 'injection cue detected in tool input; manual review',
    };
    journal(tool, subject, escalated, mode, softened);
    emit(escalated.action, escalated.reason);
    return;
  }

  journal(tool, subject, { ...applied, reason }, mode, softened);
  emit(applied.action, reason);
}

main().catch((error) => {
  // Fail closed: on error, require manual approval rather than allowing.
  emit('ask', `guard error, failing closed to manual approval: ${error?.message ?? error}`);
});
