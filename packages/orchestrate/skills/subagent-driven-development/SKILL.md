---
name: subagent-driven-development
description: Execute a multi-task plan as a controller that dispatches one fresh-context subagent per task, reviews each result against the spec, loops fixes, and tracks progress in a durable ledger. Use for any non-trivial build so the controller's context stays lean and every task is independently reviewed.
user-invocable: true
---

# Subagent-Driven Development

The controller never writes the code itself. It dispatches work to fresh subagents, one task at a time, and gates every result. This keeps the controller's context small (it holds the plan + the ledger, not the diffs) and makes each task independently verifiable.

## Loop

1. **Plan → ledger.** Break the work into tasks. Record each in the durable ledger (`ledger_add`). The ledger survives compaction — it is the controller's memory.
2. **Per task, dispatch a fresh implementer subagent.** Hand it a self-contained brief and the files it needs. It writes its diff to a file (artifact), not into your context. Record the artifact on the ledger task.
3. **Dispatch a reviewer subagent.** It checks the artifact against the task spec on two axes: spec-compliance and quality. It returns PASS or specific issues.
4. **Fix loop.** On issues, dispatch a fix subagent with the issues + artifact. Re-review. Cap iterations; if it won't converge, mark the task `failed` and escalate.
5. **Mark done, move on.** Update the ledger (`ledger_update status=done artifact=...`). Pick the next pending task.
6. **Final broad review** once all tasks are done.

## Discipline

- **File-based handoff.** Artifacts pass as files/paths, never pasted into the controller's context.
- **Durable ledger.** Every state change is recorded so a resumed session continues exactly where it stopped (`resumeFrom` a checkpoint).
- **Loop guard.** If the same action repeats (`loop_check` reports stalled), stop and change strategy — do not burn budget.
- **Spend cap.** Gate expensive steps through `spend_check`; abort gracefully at the cap.
- **One task at a time.** Resist one-shotting the whole plan in a single subagent.

## When NOT to use

Trivial single-file edits. The controller/subagent overhead isn't worth it below ~3 tasks.
