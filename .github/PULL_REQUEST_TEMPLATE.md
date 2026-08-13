<!--
First PR here? Welcome. Nothing below is a trick question — it's the same checklist
the maintainer runs against their own work. If something doesn't apply, say so and move on.
-->

## What this changes

<!-- One or two sentences. What can the harness do after this that it couldn't before? -->

Closes #

## Why this approach

<!--
What else did you consider, and why did this win? If you changed anything architectural,
add an entry to `decisions.md` — that ledger is how the project stays coherent, and it's
append-only for a reason.
-->

## Checks

- [ ] `pnpm build` green
- [ ] `pnpm check` green (strict, `exactOptionalPropertyTypes`)
- [ ] `pnpm test` green
- [ ] `pnpm biome` clean
- [ ] `node dist/core/cli/index.js validate .` passes
- [ ] Any `SKILL.md` I touched passes `node dist/guard/cli/index.js vet <file>`

## Principles

- [ ] **Enforce below the model** — any safety or scope rule I added is deterministic code, not a request in a prompt
- [ ] **Zero overlap** — I checked `DESIGN.md` §6; this doesn't duplicate an existing capability
- [ ] **Clean-room** — I implemented this fresh. No vendored or copied source.
- [ ] **Honest by construction** — I haven't claimed anything I can't measure, and any heuristic tier says so plainly

## Anything unflattering

<!--
Genuinely wanted. A benchmark that came out worse than hoped, an edge case you couldn't
close, a platform you couldn't test — say it here. Reporting the 3.4% compression number
alongside the 99.8% one is the house style, not an exception to it.
-->
