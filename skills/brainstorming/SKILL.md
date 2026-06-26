---
name: brainstorming
description: Turn a vague request into an agreed design before any code is written. HARD GATE — produce a design and get explicit approval first; do not implement, scaffold, or edit until the user approves. Use whenever a request is non-trivial or under-specified.
user-invocable: true
---

# Brainstorming

<HARD-GATE>
Do NOT write code, scaffold a project, or edit files during this skill. The only output is an agreed design. Implementation begins only after the user explicitly approves.
</HARD-GATE>

## Process

1. **Restate the problem** in one paragraph. Surface hidden assumptions and name what's genuinely ambiguous.
2. **Challenge the premise.** Is this the right problem? What happens if we do nothing? What existing code already partly solves it?
3. **Offer 2-3 distinct approaches** — at minimum a minimal-viable and an ideal-architecture — each with effort, risk, and what it reuses.
4. **Recommend one** with a one-line reason.
5. **Get explicit approval** before proceeding. If the user disagrees with a premise, revise and loop.

## Why the gate

Code written before the problem is understood is the most expensive code there is. The forcing questions are the value, not friction. A wrong architecture chosen in five minutes costs days to unwind.

## Hand-off

On approval, the design becomes the plan for `subagent-driven-development`: each agreed piece of work becomes a ledger task.
