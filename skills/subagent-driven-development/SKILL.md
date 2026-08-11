---
name: subagent-driven-development
description: Execute a multi-task plan as a controller that dispatches one fresh-context subagent per task, reviews each result against the spec, loops fixes, and tracks progress in a durable ledger. Use for any non-trivial build so the controller's context stays lean and every task is independently reviewed.
user-invocable: true
---

# Subagent-Driven Development

The controller never writes the code itself. It dispatches work to fresh subagents, one task at a time, and gates every result. This keeps the controller's context small (it holds the plan + the ledger, not the diffs) and makes each task independently verifiable.

## Loop

1. **Plan → ledger, verification-first.** Break the work into tasks. For each, decide **how it will be verified** (a command + the expected observation) before dispatching anyone — a task without a check is not yet planned. Record it on the ledger at creation time: `ledger_add(title, verify: {command, expect})`. The `verify` field is structural, not prose in a brief — it survives compaction, server restarts, and gets handed to the implementer and reviewer identically. The ledger is file-backed (under `.ideal-harness/`), so it survives both context compaction and an MCP-server restart — it is the controller's memory. Use the `scout` agent first when the plan needs locations ("where is X") — it returns a file:line table, not file dumps.
2. **Independent second opinion, for non-trivial plans.** Before dispatching any implementer, spawn `plan-critic` with the plan/ledger tasks — it runs at a different model tier (pinned in its own frontmatter) than the authoring conversation, so its critique is a genuinely different reasoning trace, not the same model re-reading its own output. Treat it like the reviewer gate: a blocker sends the plan back for revision; PASS or only minor issues let the loop continue. This is the harness's dual-model consensus gauntlet — skip it under the same bar as "When NOT to use" below (trivial plans, <3 tasks); it's a consensus gate, not mandatory friction on every change.
3. **Per task, dispatch a fresh `implementer` agent.** Hand it a self-contained brief: task spec, file paths, and the ledger task's `verify` command + expected observation (pull it from `ledger_status`, don't re-derive it). It writes its diff to a file (artifact), not into your context, runs the verification itself, and reports faithfully. Record the artifact on the ledger task.
4. **Dispatch the `reviewer` agent.** Hand it the same `verify` field from the ledger. It checks the artifact against the task spec on two axes: spec-compliance and quality — and verifies by default via the `ledger_verify` MCP tool (a real, policy-gated subprocess run that sets the task's status from the actual result), falling back to re-running `verify.command` itself only when `ledger_verify` can't auto-run it. Either way it never trusts the implementer's claim outright. It returns PASS or severity-tagged issues.
5. **Fix loop.** On issues, dispatch a fix subagent with the issues + artifact. Re-review. Cap iterations; if it won't converge, mark the task `failed` and escalate.
6. **Mark done, move on.** Update the ledger (`ledger_update status=done artifact=...`). Pick the next pending task.
7. **Final broad review** once all tasks are done.

## Discipline

- **File-based handoff.** Artifacts pass as files/paths, never pasted into the controller's context.
- **Durable ledger.** Every state change is recorded so a resumed session continues exactly where it stopped (`resumeFrom` a checkpoint).
- **Loop guard.** If the same action repeats (`loop_check` reports stalled), stop and change strategy — do not burn budget.
- **Spend cap.** Gate expensive steps through `spend_check`; abort gracefully at the cap.
- **One task at a time.** Resist one-shotting the whole plan in a single subagent.

## When NOT to use

Trivial single-file edits. The controller/subagent overhead isn't worth it below ~3 tasks.
