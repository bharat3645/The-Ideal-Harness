# Roadmap

Every open issue, ranked by difficulty, with an honest effort estimate.

**New here?** Start with the 🟢 section. Comment on an issue to claim it — no formal
assignment process, it just stops two people building the same thing. If an issue is
unclear, say so in the issue; an unclear issue is the maintainer's bug, not your
comprehension problem.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. If you are contributing with an AI agent,
read [AGENTS.md](AGENTS.md) too.

**14 issues (#1, #2, #5, #7, #9, #10, #11, #12, #13, #14, #15, #16, #17, #20) shipped in
v0.3.0** — closed for real, with tests, not just marked done. `CHANGELOG.md` has the
detail; `decisions.md` D035–D040 has the reasoning behind each design call.

---

## 🟢 Starter — a few hours, no need to understand the whole system

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#6](../../issues/6) | Verify Tier-2 on Cursor / Cline / Codex / Gemini | testing + docs | 2–3h |

**#6 needs no TypeScript at all** — it is real testing work, and finding something broken
is a success, not a failure. This is currently the only starter-difficulty issue open;
check back after the next backlog pass or open a new one if you find something.

## 🟡 Intermediate — half a day to two days

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#8](../../issues/8) | Reproducible public benchmark corpus | `bench`, docs | ~1d |

**#8 needs a public target**, not just code — the deliverable is a corpus + a
reproducible run against it, not a synthetic fixture.

## 🔴 Advanced — multi-day, design decisions required

Discuss the approach in the issue before writing much code. Several of these have a
dependency question attached, and this project ships **zero runtime dependencies** — so
adding one is a real decision needing a `decisions.md` entry, not an assumption.

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#3](../../issues/3) | Auto-apply compression via `PostToolUse` | `compress`, hooks | 2–3d |
| [#4](../../issues/4) | Auto-apply the sandbox via `PreToolUse` | `guard`, hooks | 2–3d |
| [#19](../../issues/19) | SQLite-FTS5 + vector rerank for episodic memory | `memory` | 5d+ |
| [#35](../../issues/35) | Windows sandbox hardening (network egress + process visibility) | `guard` | multi-day |
| [#36](../../issues/36) | `vet_skill_deep` parser bugs: path-prefixed semgrep `check_id`, unreachable osv-scanner `critical` severity, `env: {}` breaks semgrep on Windows | `guard/vet` | ~1d |

**#3 and #4 are the highest-leverage items left on the roadmap.** Both capabilities exist
and are tested; they just have to be called manually today. Wiring them into the hook
contract turns "the model has to remember to use this" into "this just happens." They
pair naturally — same architecture, opposite ends of the call. Say so in the issue if you
want both and the other will be held for you.

**#19 needs a dependency decision first, argued in the issue before code.** SQLite-FTS5
isn't available zero-dependency across this project's supported Node range (`node:sqlite`
is Node 22.5+-only and still experimental; this project supports 21+), and a real vector
rerank needs an embedding source from somewhere. See `decisions.md` D007 for the bar a new
dependency has to clear.

**#35 and #36 both live in `src/guard/`,** which is self-policy-protected — the harness's
own floor denies writing there through the harness itself, on purpose, so a model can't
quietly widen its own enforcement contract. Neither blocks a human contributor working
normally; both were found and written up in detail (failing tests included, for #36) by
this project's own dogfooding, then handed off rather than routed around.

---

## Ways to help that need no TypeScript

All of these are real contributions and all of them are wanted:

- **[#6](../../issues/6)** — run it on a Tier-2 host and report what happens
- **[#8](../../issues/8)** — benchmarking against a public corpus
- Try the quickstart on a clean machine and note every place it does not match reality
- **Argue with `decisions.md`.** If a scope call looks wrong, open an issue and make the case. That file is the reasoning behind the architecture and it is not sacred.

## Not on the roadmap

Stated so nobody spends a weekend on something that will be declined:

- **Multi-backend runtime.** Portability is two honest tiers, not a universal abstraction — see `decisions.md` D013.
- **Bundling or downloading a browser.** The `/browse` daemon (`src/web/browse/`, shipped
  2026-08-13, `decisions.md` D034 — superseding D012's earlier fetch-only stance) depends
  on the operator's own installed Chrome/Chromium/Edge, found via `CHROME_PATH` or
  well-known per-platform paths, never downloaded or vendored. That scope boundary stays;
  the "no browser automation at all" boundary it replaced does not.
- **A hosted or managed policy service.** Team policy is a git-tracked, PR-reviewed file on purpose — D014.
- **New floor modes, profiles or environment variables.** There are already five ways to loosen the floor. New capability is welcome; new knobs almost never are.
- **A seventh module.** `core`, `guard`, `compress`, `memory`, `orchestrate`, `web` are the
  whole surface. Operational tooling that reads a module's output without changing its
  enforcement (report generation, OTel export) lives in `scripts/`, not a new module —
  see `decisions.md` D040 for the reasoning, most recently applied to #18.

---

## Current state, stated plainly

- **v0.3.0 is not yet published to npm.** The registry's latest is `0.1.0` — the package
  is behind this repo; build from source until a `v0.3.0` tag is pushed.
- **6 of 9 originally-designed modules ship as real code.** `VISION.md` §7 has the full status table.
- **Tier-2 enforcement is not automatic.** Hook-driven enforcement is Claude Code-specific; on other MCP hosts the host must call the policy, sandbox and vetting CLIs itself. Stated openly rather than papered over.
- **4 tests are environment-conditional, not flaky.** `test/guard/vet-external.test.ts`'s
  semgrep/osv-scanner integration tests skip when those binaries aren't on PATH (true in
  CI) and run for real when they are (true on a dev machine with both installed) — see
  `README.md`'s Verification section for the exact counts.
