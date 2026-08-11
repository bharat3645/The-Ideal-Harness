---
name: tdd
description: Write the failing test before the implementation, for a single piece of code — red, green, refactor. A finer grain than the ledger's task-level verify.command (subagent-driven-development); use this INSIDE an implementer's work on one task, not as a replacement for the ledger.
user-invocable: true
---

# TDD (red, green, refactor)

`subagent-driven-development`'s ledger verifies a whole TASK is done via `verify.command`. This
skill is the finer-grained discipline for the code written INSIDE one task: prove the test fails
for the right reason before making it pass, one small cycle at a time. The two compose — a task's
`verify.command` is often literally "run the test suite this skill was used to write."

## Process

1. **Write one test for the next smallest behavior**, not the whole feature. Name it for the
   behavior, not the implementation ("rejects a negative amount", not "test3").
2. **Run it and confirm it fails for the stated reason** — a test that passes before the code
   exists, or fails with an unrelated error, proves nothing. Read the actual failure output.
3. **Write the minimum code to pass it.** Resist writing more than the current test demands; the
   next test will demand the next piece.
4. **Run the full local suite**, not just the new test — a green new test next to a broken old one
   is not progress.
5. **Refactor with the tests green**, if the code asks for it. Never refactor and add behavior in
   the same step — that's two changes wearing one commit.
6. Repeat from 1.

## Boundary

This is a per-change discipline, not a project methodology mandate — some code (glue, config,
generated bindings) isn't worth testing this granularly, and this skill doesn't override that
judgment. It also isn't a substitute for the ledger's task-level `verify.command`: a task can pass
every unit test this cycle produced and still fail its real acceptance check (e.g. an integration
behavior no unit test covers) — the ledger's verify is still the thing that decides "done."
