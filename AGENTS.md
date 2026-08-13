# AGENTS.md

Instructions for AI coding agents contributing to The Ideal Harness, and for the humans
operating them.

If you are a human, read [CONTRIBUTING.md](CONTRIBUTING.md) instead — it covers the same
ground for people. This file exists because a growing share of contributions arrive via
Claude Code, Cursor, Codex, Aider and similar, and an agent that hasn't been told this
project's constraints will confidently violate all of them.

---

## Read this before you write code

This repo is an **enforcement floor that runs below other people's models, in production**.
A defect here is not a broken feature — it is a security incident on someone else's
machine. Hold yourself to a higher bar than you would on an ordinary codebase.

Four constraints are non-negotiable. They are checked in review and a PR that breaks one
will be rejected regardless of how good the rest is.

### 1. Enforce below the model

Any safety or scope rule must be **deterministic code** — a hook, a gate, a scanner. Never
a sentence in a prompt asking a model to behave.

If your instinct is "add an instruction telling the agent not to do X," stop. That is the
exact pattern this project exists to replace. The rule belongs in `guard` as code that runs
whether the model cooperates or not.

### 2. Zero overlap

Each capability has exactly one home. Before adding anything, check `DESIGN.md` §6 and
`decisions.md`. If a capability already exists, extend it. Do not add a second mechanism
that does the same thing differently — that is how a codebase becomes four competing
notions of "state."

### 3. Clean-room

Lift **ideas**, not code. If you have seen a good implementation elsewhere, implement the
algorithm fresh with your own tests. Do not vendor, do not copy files, do not paste from
another project. This applies to code you may have memorised from training data as much as
to code you fetch during a session — if you are reproducing a specific implementation
rather than solving the problem, stop.

### 4. Honest by construction

Do not claim a capability you cannot measure. If a tier is a heuristic, say so in the code
and the docs, and do not let it present as authoritative.

This applies to your own PR description. If your change works on macOS and you could not
test Linux, write that. If a benchmark came out worse than expected, report the number.
The project publishes a 3.4% compression result next to a 99.8% one on purpose — a PR that
quietly omits the unflattering half is a worse contribution than one that includes it.

---

## What you must not do

- **Do not touch `.claude-plugin/`, `ideal-harness.policy.json`, `.ideal-harness/team-policy.json`,
  `.ideal-harness/leases.json`, or the files under `hooks/`** without an explicit human
  instruction naming the file. These are the floor's own configuration. `CLAUDE.md` says
  never touch them, and that instruction is load-bearing.
- **Do not add a runtime dependency.** `package.json` has no `dependencies` key and that is
  a deliberate, defended property (`decisions.md` D007, D028) — it is a supply-chain claim
  the project makes publicly. `web-tree-sitter` is a devDependency loaded via dynamic
  import inside a try/catch, degrading to the regex tier when absent. Any new dependency
  needs a `decisions.md` entry arguing for it, agreed with the maintainer **before** you
  write the code.
- **Do not weaken a default to make a test pass.** If a test fails because the floor denies
  something, the answer is a narrower policy rule or a lease in the test — not a broader
  default.
- **Do not rewrite `decisions.md` history.** It is append-only. Superseding an entry means
  adding a new one that says so, not editing the old one.
- **Do not fabricate benchmark numbers, test counts, or capability claims** in docs. Every
  number in `README.md` traces to `BENCHMARK.md`. If you change behaviour that affects a
  published number, either re-measure or say plainly that it needs re-measuring.

---

## Before you open a PR

Run all of these. A change is not done until every one is green:

```bash
pnpm build
pnpm check      # strict, exactOptionalPropertyTypes
pnpm test       # node:test, zero test-framework deps
pnpm biome
node dist/core/cli/index.js validate .
node dist/guard/cli/index.js vet <any SKILL.md you touched>
```

If you cannot run them — because you are operating without shell access, or in a sandbox
without the toolchain — **say so explicitly in the PR description**. Do not claim checks
passed that you did not run. A PR that says "I could not run the test suite in my
environment" is welcome. One that claims green checks it never executed is not.

---

## How to read this codebase

You did not write it, and the architecture is not guessable from the source alone. Read in
this order:

| File | What it answers |
|---|---|
| `README.md` | What each module does, and what runs automatically vs. on demand |
| `CLAUDE.md` | Project conventions, layout, and the do-not-touch list |
| `decisions.md` | **Why** every scope call was made — alternatives considered, what lost |
| `flow.md` | Runtime sequences as diagrams — the actual order things happen in |
| `DESIGN.md` | The 9-layer architecture and source adjudication (historical, but foundational) |
| `VISION.md` | Direction, personas, anti-goals, roadmap status |
| `BENCHMARK.md` | What has been measured and how |

Before proposing an architectural change, search `decisions.md` for the topic. The answer
to "why isn't this done the obvious way" is usually recorded there, with reasoning, at the
time the call was made.

---

## Scope discipline

Agents tend to over-deliver. On this repo that is a liability, not a virtue.

- **One issue per PR.** If you notice something else broken while working, open a separate
  issue rather than fixing it in the same branch. A reviewer cannot meaningfully review a
  diff that does four unrelated things.
- **Do not refactor adjacent code you were not asked to touch.** Even if it would be
  better. It expands the review surface and hides the real change.
- **Do not reformat.** Biome owns formatting. If a file looks wrong, it isn't.
- **Do not add abstraction for hypothetical future needs.** This codebase deliberately
  chooses one mechanism per capability. Speculative generality is the failure mode it is
  organised against.

---

## Writing tests

Tests use `node:test` with **zero test-framework dependencies**. Match the existing style
in `test/` — do not introduce Jest, Vitest, Chai or any assertion library.

Test the failure paths, not just the happy one. For this project specifically, that means:

- What happens when the file is missing, corrupt, empty, or enormous?
- What happens on a platform where the underlying facility is unavailable?
- Does it fail **open** or **closed**, and is that the documented behaviour for this
  component? (Policy evaluation fails closed. The audit journal fails open. These are
  different on purpose — check which one you are touching.)
- If it is concurrent, what happens when two processes do it at once?

---

## Commit and PR conventions

- Small, focused commits. Branch off `main`.
- Commit messages explain the *why*, not the diff.
- Comments are timeless — explain the non-obvious reasoning, never the edit history. Do not
  write "changed X to Y" in a code comment.
- Fill in the PR template honestly, including the "anything unflattering" section.
- If your change is architectural, add a `decisions.md` entry in the same PR.

---

## Disclosure

If you find a security vulnerability while working — a policy bypass, a redaction gap, a
path traversal — **do not open a public issue and do not describe it in a PR title**. Follow
[SECURITY.md](SECURITY.md). This project is installed on other people's machines; a public
report before a fix exists puts them at risk.

---

## For the human operating the agent

You are responsible for what your agent submits. Specifically:

- **Read the diff before you push it.** Every line. An agent that has been told all of the
  above can still be confidently wrong about the codebase's actual invariants.
- **Verify the checks really ran.** Do not take the agent's word for a green suite.
- **You are the author.** Sign off on the PR as work you stand behind, not as output you
  forwarded.

Contributions from agents are genuinely welcome here — the project is, after all, about
making agents safe to hand real access to. But the same principle applies to contribution
as to execution: the human is the floor, and the floor does not delegate.
