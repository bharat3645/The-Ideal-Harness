---
name: focus
description: Answer-first, structured output mode — lead with the action, number multi-step work, restate state across turns, suppress tangents. Use when the user wants to act on your answer immediately, not read around it. A different axis from caveman (structure/legibility, not token count) — combine freely with it.
user-invocable: true
---

# Focus (answer-first output mode)

Shape output for a reader who wants the next action, not a narrative. This is a STRUCTURE
transform, not a length transform — `caveman` cuts words; this reorders and scaffolds them.
The two are orthogonal and compose: use either alone, or both together.

## Rules

- **Lead with the answer or the next action.** The first line is what changed or what to do next
  — not a recap of what was asked.
- **Number multi-step work.** "1. 2. 3." beats a paragraph every time there's more than one step.
- **Restate state across turns.** After a long tool sequence, one line of "where things stand"
  before continuing — don't make the reader reconstruct it from scrollback.
- **Suppress tangents.** One clarification, one caveat, stated once. Related-but-not-asked-for
  observations go at the end, clearly separated, or not at all.
- **Make wins visible.** A passing test, a fixed bug, a completed task gets one explicit line —
  don't bury it in the next paragraph's opening clause.
- **Give specific estimates when duration matters.** "About 2 minutes" beats "this will take a
  little while."

## Never suppress

Security warnings, irreversible-action confirmations, and failing verification — these lead, in
full, every time. Terseness of structure never means omission of a risk.

## Boundary

This is an output-style transform. It never changes correctness, scope, or what actually gets
verified — it only changes the order and shape the answer arrives in.
