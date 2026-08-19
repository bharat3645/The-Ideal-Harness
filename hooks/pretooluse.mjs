#!/usr/bin/env node
/**
 * PreToolUse hook — the automatic (Tier-1) enforcement gate.
 *
 * Evaluates every tool call against the deny-wins policy, blocks outbound
 * secrets, flags injection cues, and journals every decision. Fails CLOSED to
 * manual approval ('ask') on any internal error — a broken gate must never
 * silently allow.
 *
 * When a `Bash` call is actually going to run (the final decision is
 * `allow`, on macOS/Linux, with the platform's sandbox tool present), the
 * command is auto-wrapped in the same OS sandbox `ledger_verify` already
 * applies manually (`src/guard/sandbox.ts`'s `buildSandboxCommand`), via the
 * `updatedInput` contract — so sandboxing "just happens" for whatever
 * already reached `allow`, instead of requiring a caller to remember to
 * invoke it (issue #4). Deliberately narrow in scope: no extra writable
 * paths beyond the working directory, network access OFF by default. This
 * is safe specifically because of what actually reaches `allow` under the
 * default floor — mostly read-only git (`git status|log|diff`) — commands
 * that never needed network in the first place; an operator who has added a
 * broader custom allow rule via `ideal-harness.policy.json` should be aware
 * this now sandboxes those calls too, no-network by default, and that a
 * command that genuinely needs network will fail loudly under the sandbox
 * rather than silently misbehave. Kill switch: `IDEAL_HARNESS_AUTO_SANDBOX=off`.
 * Also applied under `bypass` mode, matching PostToolUse's own "hygiene
 * stays on even when the permission floor is waived" precedent — bypass
 * relaxes the permission decision, not the safety nets around it.
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
  buildSandboxCommand,
  consumeLeaseIfDecided,
  evaluateTiered,
  FLOOR_MODE_ENV_VAR,
  floorMode,
  looksLikeInjection,
  redactSecrets,
  resolveOperatorTiers,
  sandboxToolAvailable,
  subjectFor,
} from '../dist/guard/index.js';

const EGRESS_TOOLS = new Set(['Bash', 'WebFetch', 'Write', 'Edit', 'NotebookEdit']);

const KNOB_HINT = 'operator knobs: IDEAL_HARNESS_FLOOR_MODE=soft|bypass, or ideal-harness.policy.json';

function emit(decision, reason, updatedInput) {
  const hookSpecificOutput = {
    hookEventName: 'PreToolUse',
    permissionDecision: decision,
    permissionDecisionReason: reason,
  };
  if (updatedInput !== undefined) {
    hookSpecificOutput.updatedInput = updatedInput;
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

function warn(message) {
  process.stderr.write(`[ideal-harness] ${message}\n`);
}

function journal(tool, subject, decision, mode, softened) {
  appendJournalEntry(buildJournalEntry({ ts: new Date().toISOString(), tool, subject, decision, mode, softened }));
}

/** POSIX shell single-quote escaping — safe for any argv element, including one
 *  containing embedded single quotes, spaces, or shell metacharacters. */
function shellQuoteArgv(argv) {
  return argv.map((arg) => `'${String(arg).replace(/'/g, "'\\''")}'`).join(' ');
}

function detectPlatform() {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'other';
}

/** Wrap a Bash command's argv in the OS sandbox, if one is available on this platform.
 *  Returns null (no wrap) rather than throwing — a broken/absent sandbox tool must
 *  never block a call that already passed policy; it just runs unsandboxed. */
function autoSandboxCommand(command) {
  if (process.env.IDEAL_HARNESS_AUTO_SANDBOX?.trim().toLowerCase() === 'off') {
    return null;
  }
  const platform = detectPlatform();
  if (platform === 'other') {
    return null;
  }
  try {
    const built = buildSandboxCommand(['/bin/sh', '-c', command], platform, { workdir: process.cwd() });
    if (!built.ok || !sandboxToolAvailable(built.argv[0])) {
      return null;
    }
    return shellQuoteArgv(built.argv);
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
    let bypassUpdatedInput;
    if (tool === 'Bash' && typeof input.command === 'string') {
      const wrapped = autoSandboxCommand(input.command);
      if (wrapped !== null) {
        bypassUpdatedInput = { ...input, command: wrapped };
      }
    }
    emit(decision.action, decision.reason, bypassUpdatedInput);
    return;
  }

  // Compose tiers: capability leases first (most specific, shortest-lived),
  // then personal user policy, then the shared/git-tracked team policy
  // (.ideal-harness/team-policy.json — a plain committed file, never a
  // hosted service), then the default floor. Same composition `ledger_verify`
  // and `web_fetch`/`web_docs` use for their own non-interactive gating
  // (resolve.ts) — one tier-resolution path, not three drifting copies. Any
  // loader problem falls back to the pristine defaults — a broken policy
  // file must never widen or silently narrow the floor.
  const { tiers, warnings: tierWarnings } = resolveOperatorTiers();
  for (const message of tierWarnings) {
    warn(`policy: ${message}`);
  }

  let decision = evaluateTiered({ tool, input }, tiers);
  consumeLeaseIfDecided(decision);

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

  // Explain-mode: every non-allow decision names its rule and the knobs that
  // could change it — uniform across deny AND ask, not just hard denies, so
  // "why am I being asked" is answered exactly like "why was this denied."
  let reason = applied.reason;
  if (applied.action === 'deny' || applied.action === 'ask') {
    reason = `${reason} [rule=${applied.ruleId}; ${KNOB_HINT}]`;
  }

  // Escalate on injection cues in the request.
  if (applied.action === 'allow' && looksLikeInjection(JSON.stringify(input))) {
    const escalated = {
      action: 'ask',
      ruleId: 'injection-cue',
      reason: `injection cue detected in tool input; manual review [rule=injection-cue; ${KNOB_HINT}]`,
    };
    journal(tool, subject, escalated, mode, softened);
    emit(escalated.action, escalated.reason);
    return;
  }

  journal(tool, subject, { ...applied, reason }, mode, softened);

  // Only a call that is ACTUALLY going to run (final decision: allow) gets
  // wrapped — never for ask/deny, and never ahead of the injection-cue check
  // above, which can still escalate an allow to ask.
  let updatedInput;
  if (applied.action === 'allow' && tool === 'Bash' && typeof input.command === 'string') {
    const wrapped = autoSandboxCommand(input.command);
    if (wrapped !== null) {
      updatedInput = { ...input, command: wrapped };
    }
  }

  emit(applied.action, reason, updatedInput);
}

main().catch((error) => {
  // Fail closed: on error, require manual approval rather than allowing.
  emit('ask', `guard error, failing closed to manual approval: ${error?.message ?? error}`);
});
