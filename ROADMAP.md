# Roadmap

Every open issue, ranked by difficulty, with an honest effort estimate.

**New here?** Start with the 🟢 section. Comment on an issue to claim it — no formal
assignment process, it just stops two people building the same thing. If an issue is
unclear, say so in the issue; an unclear issue is the maintainer's bug, not your
comprehension problem.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. If you are contributing with an AI agent,
read [AGENTS.md](AGENTS.md) too.

---

## 🟢 Starter — a few hours, no need to understand the whole system

Pick one of these first. Each is self-contained, with a clear correctness bar, and
touches one part of the codebase rather than several.

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#12](../../issues/12) | Doc drift — `plan.md` banner, CHANGELOG arithmetic | docs only | ~1h |
| [#10](../../issues/10) | Validate `baseRef` in `worktree_create` | `orchestrate` | <1h |
| [#9](../../issues/9) | Add Node 20 to the CI matrix | CI config | ~1h + fixes |
| [#11](../../issues/11) | Bracketed IPv6 literals in `checkUrlSafety` | `web`, tests | 1–2h |
| [#1](../../issues/1) | Add **Go** to the tree-sitter tier | `memory` | 2–4h |
| [#2](../../issues/2) | Add **Rust** to the tree-sitter tier | `memory` | 2–4h |
| [#6](../../issues/6) | Verify Tier-2 on Cursor / Cline / Codex / Gemini | testing + docs | 2–3h |

**#12 and #10 are the two easiest.** #6 needs no TypeScript at all — it is real testing
work, and finding something broken is a success, not a failure.

## 🟡 Intermediate — half a day to two days

You will need to read a module properly before starting. All of them have stable
contracts around them, so the shape of the work is clear even if the work isn't small.

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#16](../../issues/16) | Workspace-stamp the structural graph snapshot | `memory` | ~0.5d |
| [#7](../../issues/7) | semgrep + osv-scanner integration tests | `guard/vet` | 0.5d |
| [#14](../../issues/14) | Spend governor resets on restart | `orchestrate` | ~0.5d |
| [#13](../../issues/13) | CCR store — cap, evict, fix the lossy CLI path | `compress` | 0.5–1d |
| [#15](../../issues/15) | Episodic store grows unbounded | `memory` | 0.5–1d |
| [#8](../../issues/8) | Reproducible public benchmark corpus | `bench`, docs | ~1d |
| [#20](../../issues/20) | OWASP Agentic Top 10 coverage table | docs + reading `guard` | ~1d |

**#20 is the best way to learn the security model** without writing code — you have to
read `guard` carefully to fill the table honestly.

**#7 has real teeth:** you are checking whether code that has never run against the actual
binaries actually works. Finding it broken is the valuable outcome.

## 🔴 Advanced — multi-day, design decisions required

Discuss the approach in the issue before writing much code. Several of these have a
dependency question attached, and this project ships **zero runtime dependencies** — so
adding one is a real decision needing a `decisions.md` entry, not an assumption.

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#3](../../issues/3) | Auto-apply compression via `PostToolUse` | `compress`, hooks | 2–3d |
| [#4](../../issues/4) | Auto-apply the sandbox via `PreToolUse` | `guard`, hooks | 2–3d |
| [#5](../../issues/5) | Close the DNS-rebinding gap in the SSRF guard | `web` | 2–4d |
| [#17](../../issues/17) | Concurrency control on persisted state | `memory`, `orchestrate` | 3–5d |
| [#18](../../issues/18) | OpenTelemetry span export from the guard journal | `guard` | 3–5d |
| [#19](../../issues/19) | SQLite-FTS5 + vector rerank for episodic memory | `memory` | 5d+ |

**#3 and #4 are the highest-leverage items on the roadmap.** Both capabilities exist and
are tested; they just have to be called manually today. Wiring them into the hook contract
turns "the model has to remember to use this" into "this just happens." They pair
naturally — same architecture, opposite ends of the call. Say so in the issue if you want
both and I'll hold the other.

**#18 is the highest-leverage item for adoption.** Without it, the audit journal cannot
reach the Langfuse / Phoenix / Datadog stacks every serious team already runs — so the
project competes with the observability ecosystem instead of composing with it.

**#17 is the hardest correctness problem currently open.**

---

## Ways to help that need no TypeScript

All of these are real contributions and all of them are wanted:

- **[#6](../../issues/6)** — run it on a Tier-2 host and report what happens
- **[#20](../../issues/20)** — the OWASP coverage table
- **[#12](../../issues/12)** — documentation drift
- **[#8](../../issues/8)** — benchmarking against a public corpus
- Try the quickstart on a clean machine and note every place it does not match reality
- **Argue with `decisions.md`.** If a scope call looks wrong, open an issue and make the case. That file is the reasoning behind the architecture and it is not sacred.

## Not on the roadmap

Stated so nobody spends a weekend on something that will be declined:

- **Multi-backend runtime.** Portability is two honest tiers, not a universal abstraction — see `decisions.md` D013.
- **Browser automation in `web`.** Deliberately `fetch()`-only — D012.
- **A hosted or managed policy service.** Team policy is a git-tracked, PR-reviewed file on purpose — D014.
- **New floor modes, profiles or environment variables.** There are already five ways to loosen the floor. New capability is welcome; new knobs almost never are.

---

## Current state, stated plainly

- **v0.2.0 is not yet published.** The npm package is behind this repo — build from source. See the publish-freshness note in the README.
- **6 of 9 originally-designed modules ship as real code.** `VISION.md` §7 has the full status table.
- **Tier-2 enforcement is not automatic.** Hook-driven enforcement is Claude Code-specific; on other MCP hosts the host must call the policy, sandbox and vetting CLIs itself. Stated openly rather than papered over.
