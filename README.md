# The Ideal Harness

**The control-plane OS around a stateless model — it turns probabilistic reasoning into deterministic, governed, safe action.**

An agent harness with deep Claude Code integration and an MCP-portable enforcement and tooling core.

`github.com/bharat3645/The-Ideal-Harness` · MIT · built by Bharat

---

## The problem

Every "best harness" is a partial.

- The **skills** project gives you reusable workflows, but no enforcement — a skill can tell the agent to run `curl … | bash` and nothing stops it.
- The **memory** project remembers, but does not compress — it hands the model whole files and burns the context window it was meant to save.
- The **compression** project compresses, but does not remember — it shrinks one tool result and forgets the rest of the session.
- The **orchestration** project sequences work, but assumes you *are* the harness — it lives inside one host, and the moment you switch agents the guarantees evaporate.

Each one is real and good. None of them is the whole stack. Wire four of them together and you get four overlapping notions of "state," two competing policy stories, and a safety floor that is really just a polite paragraph in a prompt.

So we built the one that has every layer, with no overlap.

## What it is

The Ideal Harness is the control-plane OS around a stateless model: it turns probabilistic reasoning into deterministic, governed, safe action. It is a clean-room synthesis of best-of-breed ideas from ~30 leading harness, skill, memory, and web repos — Superpowers, gstack, gsd-core, hermes, omnigent, headroom, graphify, claude-mem, chrome-devtools-mcp, impeccable, SkillSpector, last30days, firecrawl, and others — rationalized into **one coherent monorepo where every capability has exactly one home**. One chosen mechanism per capability. The alternatives we rejected are documented, not silently dropped.

We read those ~30 repos to ground truth, took the best idea from each, and threw away the vaporware. What survived is six modules that share one substrate and one enforcement floor, with zero feature overlap between them.

The safety layer is not advice to the model. It is deterministic code that runs **below** the model, on `PreToolUse` / `PostToolUse` hooks. The model proposes; the floor disposes.

## The numbers

Measured on a real codebase (the Voraxx worker source: 105 files, 33,629 LOC, indexed in 16 ms into 2,707 symbols; whole-repo secret scan covered 2,577 files). These are the only metrics we claim, and a couple of them are deliberately unflattering — the ones that *can't* be faked are the proof that the rest are real. The Voraxx corpus is external and is **not** bundled in this repo, so these exact token counts can't be re-run from here; the methodology and per-case breakdown are in [`BENCHMARK.md`](./BENCHMARK.md), and the compressors themselves are covered by the in-repo unit tests.

| Capability | Measurement | Result |
|---|---|---|
| **Context (code-graph)** | answer a code question via token-budgeted subgraph vs reading the files | ~1,988 tokens vs 17,323–37,369 → **8.7x–18.8x** less |
| **Compression (structured)** | 2,707-row JSON tool output | 100,728 → 196 tokens → **99.8% saved** |
| **Compression (log)** | 2,969-line grep log, mostly unique lines | 91,544 → 88,402 tokens → **3.4% saved** |
| **Secret redaction** | swept 2,577 files | flagged 40 secret-shaped strings across 18 files |
| **Policy engine** | 10 realistic requests | 2 allow / 4 ask / 4 deny |
| **Drift-guard** | 3 real symbols + 1 fabricated | 3 found, 1 flagged missing, 0 false hard-block |
| **Malicious-skill vet** | skill with `curl … \| bash` + "ignore all previous instructions" | blocked (high severity) |

On the honest ones:

- **3.4% on the grep log is the whole point.** Unique lines barely compress, so we report it plainly. Structured output collapses from 100,728 to 196 tokens; an unstructured log does not. A harness that claimed otherwise would be lying.
- **The 40 secret-shaped strings** include test fixtures; the named categories break down as jwt 10, private-key 5, bearer 5, aws 2, anthropic 1, github 1, with the remainder in unnamed categories. The claim is *deterministic detection before anything reaches the model or the logs* — not "this repo is leaking."
- **The policy denials** were credential reads, `rm -rf`, and a write to the policy file itself. The floor refuses to let the agent edit its own floor.
- **The drift-guard** was handed 3 real symbols and 1 invented one: it found all 3, flagged the fabricated one missing, and hard-blocked nothing real. Hallucinated symbols get caught before they become broken edits.
- **The vetting scanner** blocked a skill carrying `curl … | bash` and "ignore all previous instructions" at high severity — before it could be installed, not after it ran.

## The six modules

Each is an independently installable plugin; `core` is required. Every engine also runs as a standalone MCP server and CLI.

| Module | Role | What lives here |
|---|---|---|
| `core` | substrate | Plugin loader, manifest + skill validation, dependency-free skill templating with multi-host generation (Claude Code, Codex, Gemini, Cursor), a bootstrap skill, and the minimal MCP stdio server every other engine reuses. |
| `guard` | enforcement floor, below the model | Deny-wins / fail-closed policy engine (leases > user policy > team policy > default floor) with Anthropic-aligned defaults, prompt-injection wrapping, always-on secret redaction, a scoped secrets broker, a skill-vetting scanner (threat-signature DB + homoglyph / hidden-char detection), a drift-guard authority ladder that catches hallucinated symbols, a hash-chained audit journal, time/call-boxed capability leases, and an OS sandbox command builder (Seatbelt / bubblewrap) with subprocess env-scrub. `PreToolUse` / `PostToolUse` hooks make **policy, outbound-secret blocking, secret redaction, and injection fencing** automatic; sandbox, vetting, drift-guard, leases, and the broker are MCP tools / CLIs the host invokes (see below). |
| `compress` | context economy | Deterministic, prompt-cache-safe `tool_result` compression — anomaly-preserving JSON sampling, log RLE, stack-trace collapse — gated by a token threshold, with a Compress-Cache-Retrieve (CCR) store for lossless recovery, plus the caveman output-side terse mode. |
| `memory` | recall | A structural code-graph (optional tree-sitter tier, persisted + incrementally re-indexed) with token-budgeted subgraph retrieval, and an episodic store ranked by real BM25 relevance — with consolidation/decay, provenance (`evidence`) on records, and a CLI-only Obsidian export/import bridge — kept honest by a curator that reconciles claims against tool-call evidence. |
| `orchestrate` | control flow | Durable task ledger with **real, policy-gated, sandboxed verification** (`ledger_verify` actually runs a task's check instead of trusting a self-report), worktree fan-out for parallel tasks, a retro generator, loop / no-progress guard, spend governor, API retry / backoff, session resume / checkpoint, plus subagent-driven-development and brainstorming (HARD-GATE) skills. |
| `web` | grounding | Deliberately scoped to `fetch()` + a hand-rolled HTML extractor — no browser/scraping dependency (see `decisions.md` D012). `web_fetch` for any URL, `web_docs` for live npm registry metadata/README (fights stale-training-data hallucination on package APIs). Both policy-gated exactly like the native `WebFetch` tool, including the operator's own policy/lease configuration, plus an SSRF guard (blocks localhost/private/link-local/cloud-metadata targets and re-validates every redirect hop — DNS-rebinding is a stated, not hidden, residual gap; see `decisions.md` D026). |

## Universality, told honestly

This is **not** a multi-backend runtime. Portability comes in two tiers, and we draw the line where it actually is.

- **Tier 1 — deep, Claude Code-native.** `SessionStart` / `PreToolUse` / `PostToolUse` hooks, automatic guardrails, the full skill + plugin experience. The floor enforces itself with no cooperation from the model.
- **Tier 2 — any MCP-capable agent** (Cursor / Cline / Codex / Gemini). Every engine ships as a standalone MCP server and CLI, so other hosts get the tools *and* the enforcement primitives. Skills port via multi-host `SKILL.md` generation.

**What does not travel:** hook-driven *automatic* enforcement. On a Tier-2 host, nothing fires on its own — the host must call the policy, sandbox, and vetting CLIs itself. We would rather say this out loud than pretend the floor is free everywhere.

## What runs automatically on every tool call (Tier 1)

Two `guard` hooks fire deterministically around every tool call — no prompt, no model cooperation. This is the floor that runs **on its own**:

**PreToolUse — before the call executes:**

1. **Policy check.** Deny > allow > ask, fail-closed (Claude Code's own precedence). Credential reads, `rm -rf`, and writes to the policy file are denied; read-only git is allowed; ambiguous actions become an ask, not a silent allow. The floor is **soft by default** — denies downgrade to asks so the human decides, mirroring Claude Code's out-of-the-box posture — and **operator-tunable, never model-tunable**: `IDEAL_HARNESS_FLOOR_MODE=enforce` restores hard denies, `ideal-harness.policy.json` (project root or `~/.config/`) adds a higher rule tier or disables defaults by id, and `claude --dangerously-skip-permissions` (or `IDEAL_HARNESS_DANGEROUSLY_SKIP_PERMISSIONS=1`) waives the permission gate entirely. Every softening is announced on stderr; a broken user policy falls back to the pristine defaults; an unrecognized mode value fails strict.
2. **Outbound-secret block.** Egress tools (`Bash`, `Write`, `Edit`, `WebFetch`) are scanned; a call that would carry a secret out is blocked before it runs.
3. **Decision journal + learning loop.** Every decision is appended (secret-redacted, fail-open) to `.ideal-harness/guard-journal.jsonl`; `ideal-harness-guard learn` turns repeated approvals into *proposed* allowlist entries the human may paste into the policy file — the harness never applies them itself.

**PostToolUse — on the result, before the model reads it:**

4. **Secret redaction.** The result is rewritten with secrets masked as `[REDACTED:type]` (via the `updatedToolOutput` contract) before the model sees it — the same detector that flagged 40 secret-shaped strings across 18 files on a 2,577-file repo.
5. **Injection fencing.** Web/MCP output, or any result tripping an injection cue, is wrapped in a breakout-safe `<untrusted_content>` fence so the model treats it as data, not instructions.

**At SessionStart**, the `using-ideal-harness` bootstrap skill is injected so the model knows the floor is active and how to route.

## Tools the agent or host invokes — deterministic, but not automatic

These are the rest of the floor and the engines. They are real, deterministic code exposed as **MCP tools and CLIs** — the model or host calls them deliberately; they are not (yet) hook-applied. Auto-applying sandbox (via PreToolUse `updatedInput`) and compression (via PostToolUse `updatedToolOutput`) is the next wiring step on the roadmap. See `flow.md` for the exact sequence each of these follows.

- **Sandbox** — `buildSandboxCommand` wraps a shell command in a Seatbelt / bubblewrap profile with a scrubbed env (CLI / primitive); applied automatically inside `ledger_verify` (below).
- **Compression + CCR** — `compress_tool_result` shrinks oversized JSON / logs cache-safe; `ccr_retrieve` recovers the original.
- **Drift-guard** — `verify_symbol` checks a symbol against provided sources at the grep tier (reports missing, never hard-blocks — grep cannot prove absence). `verify_symbol_structural` checks against memory's pre-extracted structural data instead, and *can* hard-block a proven-absent symbol when every source considered was parsed at the tree-sitter tier (a single regex-tier fallback in the set caps the verdict back to grep authority).
- **Skill vetting** — `vet_skill` scans skill text (threat-signature DB + homoglyph / hidden-char) before you install it; `vet_skill_deep` scans a whole skill directory the same way plus semgrep (offline, bundled ruleset) and osv-scanner (live network to osv.dev) when either is present on PATH — both shell-outs policy-gated like a Bash call, absence degrades to "skipped," never a hard failure.
- **Memory** — `query_graph`, `memory_search`, `memory_write` (+ optional `evidence`), `memory_consolidate`, `reconcile`, `add_file`. CLI-only: `vault-export` / `vault-import` (Obsidian bridge — a human-invoked act, never a model-invocable tool, by design).
- **Orchestrate** — `ledger_add` / `ledger_update` / `ledger_status`, `ledger_verify` (actually spawns the task's `verify.command`, policy-gated + sandboxed — this is what "done" being a measurement means in practice), `worktree_create` / `worktree_list` / `worktree_remove`, `loop_check`, `spend_check`.
- **Web** — `web_fetch` (any URL), `web_docs` (npm registry metadata/README) — both gated exactly like the native `WebFetch` tool, including your own policy/lease rules.
- **Guard operator tooling (CLI-only — human-run, never MCP)** — `learn` (propose allowlist entries from repeated approvals), `ratify <shape>` (one-shot proposal), `asks` (batch ask digest), `verify-journal` (check the audit chain for tampering), `lease grant|list|revoke` (time/call-boxed elevated allows — grant/revoke are CLI-only on purpose: a model that could grant its own elevated access would defeat the point of the floor being human-owned).

On Tier 2 (any MCP host) every item in **both** lists is reachable as the same MCP servers / CLIs; only the automatic hook application above is Claude-Code-specific.

## Context-budget statusline (Tier 1)

Claude Code's bottom line carries a live context-window meter — `IH <used>/<window> <pct>%` (e.g. `IH 142k/1M 14%`) — showing the tokens spent and the share of the model's **total context window** they occupy. It advises `⚠ consider /compact or /clear` past 14% and `⚠ /compact or /clear for better results` past 17%, with a `· filling fast` flag when a single turn adds a lot. It is **display + advice only**: Claude Code exposes no hook to force `/compact` mid-session, so the harness never auto-compacts. The advisory band is a *soft* quality line — answers degrade as the window fills — **not** the model's hard limit; native auto-compact stays the hard-limit backstop, and `compress`'s tool-result shrinking slows the fill. The window is **not hardcoded** — the hook reads the active model's real window from Claude Code's `context_window.context_window_size` (200k by default, 1M for extended-context models), so the percentage is correct on whatever model you run; `IDEAL_HARNESS_BUDGET_WINDOW` overrides it and ~1M is only a fallback when the host reports no window. The classification is pure, unit-tested logic in `compress`; the statusline hook reads tokens spent + window straight from Claude Code (or falls back to the transcript) and fails open to `IH —`.

## Integrating into a product or pipeline

Three embed surfaces, all real, all covered above — this section is the recipe for
wiring them into something that runs **unattended** (a CI job, a background agent, a
product embedding the harness as its own policy layer) without either stalling forever
on a human prompt that never comes, or quietly running with no limits at all.

**1. Pick your surface.**
- **MCP host** (any MCP-capable agent/product): point it at the five servers
  (`npx -y ideal-harness-guard mcp`, `-compress`, `-memory`, `-orchestrate`, `-web`).
- **Library** (embedding in your own Node/TS service): `import { evaluateTiered,
  DEFAULT_RULES, resolveOperatorTiers } from 'ideal-harness/guard'` and gate your own
  tool calls the same way the hook does — `flow.md §1–2` is the exact sequence to mirror.
- **CLI / shell pipeline**: the six `ideal-harness*` bins; `ideal-harness doctor` exits
  non-zero on any wiring problem, so it's a real CI pre-flight gate, not just a report.

**2. Choose a floor mode explicitly.** Unattended runs should not inherit the
interactive default. `IDEAL_HARNESS_FLOOR_MODE=enforce` (or the `strict` profile,
`IDEAL_HARNESS_PROFILE=strict`) makes deny mean deny and ask mean ask — no downgrading
to a human prompt that will never be answered in a pipeline. `soft` (the interactive
default) is for a human at a keyboard; `enforce` is for a job with no one watching.

**3. Grant exactly the capability the job needs, nothing standing.** Three mechanisms,
composed in this precedence (`resolveOperatorTiers`, `flow.md §2`):
- **A lease** (`ideal-harness-guard lease grant --tool Bash --match '^pnpm test$'
  --reason 'CI' --minutes 60`) for a single run or a bounded window — it expires or
  runs out of uses on its own, so a forgotten grant can't outlive the job.
- **A team policy rule** (`.ideal-harness/team-policy.json`, git-tracked, PR-reviewed)
  for the standing set of commands your pipeline always needs — auditable the same way
  the rest of your CI config is.
- **A project policy rule** (`ideal-harness.policy.json`) for anything narrower to one
  environment. All three are human-authored, PR-visible, and covered by the same
  self-policy protection that stops the harness from editing its own floor — nothing
  here is a backdoor the agent can widen itself.

**4. Verify, don't trust self-reports.** `ledger_verify` actually spawns a task's
`verify.command` and sets status from the real exit code — this is the mechanism that
lets an unattended run report "done" honestly instead of taking an LLM's word for it.
Bound it with a spend cap (`IDEAL_HARNESS_SPEND_CAP`) and the loop guard (`loop_check`)
so a stuck or looping run stops itself instead of burning budget indefinitely.

**5. Audit after the fact.** Every decision — allowed, asked, denied, softened, which
lease fired — lands in the hash-chained `.ideal-harness/guard-journal.jsonl`.
`ideal-harness-guard verify-journal` confirms nothing was tampered with; `scripts/report.mjs`
renders it (plus the ledger, memory graph, and episodic store) into one static HTML page
for a human to review after a run, no live server required.

None of this is new mechanism — it's the same floor, ledger, and journal a human uses
interactively, composed into a recipe for when no human is there to answer an `ask`. If
a call reaches an `ask` in `enforce` mode with no lease or policy rule covering it, it is
refused, not silently allowed — an unattended job that needs a capability it wasn't
granted should fail loudly and get a rule added, never fall back to guessing.

## Principles

- **Enforce below the model.** Every safety and scope rule is deterministic code — a hook, a gate, a scanner — never a polite request in a prompt.
- **Zero overlap.** One chosen mechanism per capability; the rejected alternatives are documented, not deleted in silence.
- **Honest by default.** A 3.4% compression number and a v0.1 scope note are features. The metrics we cannot fake are the evidence for the ones you cannot easily check.
- **Standards-aligned.** 12-Factor Agents compliant; aligned with published context-engineering and long-running-harness guidance and OWASP LLM06 (excessive agency).

## Architecture

```
                      ┌─────────────────────────────┐
   model proposes ──► │            guard            │ ◄── deny-wins, fail-closed
   a tool call        │  policy · sandbox · vet ·   │     PreToolUse / PostToolUse
                      │  redaction · drift-guard    │     enforcement floor
                      └──────────────┬──────────────┘
                                     │ allowed call
        ┌──────────────┬─────────────┼─────────────┬──────────────┬──────────────┐
        ▼              ▼             ▼             ▼              ▼              ▼
   ┌─────────┐   ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐  ┌──────────────┐
   │  core   │   │ compress │  │  memory  │  │orchestrate│  │   web   │  │  (your tool) │
   │substrate│   │ context  │  │  recall  │  │  control  │  │grounding│  │              │
   └─────────┘   └──────────┘  └──────────┘  └───────────┘  └─────────┘  └──────────────┘
        │
   every engine = a plugin (Tier 1)  +  an MCP server / CLI (Tier 2)
```

`guard` sits between the model and every tool. The other engines run as plugins in Claude Code (Tier 1) and as MCP servers or CLIs anywhere else (Tier 2).

## Install & quickstart

The Ideal Harness ships as a Claude Code **plugin marketplace** backed by npm. Each module is an independently installable plugin; `core` is required. **Install once, machine-wide** — plugins install at user scope and are available in every project.

### Tier 1 — install in Claude Code (recommended)

```bash
# Add the marketplace, then install the one plugin — it bundles all six modules
# (core substrate + guard/compress/memory/orchestrate/web MCP servers + hooks + skills).
# Sourced from the npm package, so built code/hooks/MCP servers wire up automatically —
# no clone, no build, no .mcp.json editing.
/plugin marketplace add bharat3645/The-Ideal-Harness
/plugin install ideal-harness@ideal-harness
```

The plugin's `source` is the `ideal-harness` npm package; installing it pulls the published tarball (which includes `dist/`, hooks, and skills) into `${CLAUDE_PLUGIN_ROOT}` and registers every module's MCP server declared in `.claude-plugin/plugin.json`, so the floor and tools work immediately. Approve the MCP servers once when prompted. (There is one plugin, not one per module — `core`/`guard`/`compress`/`memory`/`orchestrate`/`web` are source and MCP-server boundaries *within* it, not separately installable units; see `decisions.md` for why the repo consolidated this way.)

### Tier 2 — run any engine as an MCP server / CLI (any MCP host)

The package publishes as **one npm package, `ideal-harness`, with six bins** (this
matches the flattened single-package layout — see `decisions.md`; the old scoped
`@ideal-harness/*` package names were from a pre-refactor layout and should not be used
— see the note below). `npx`'s `--package`/`-p` flag selects the package; the bin name
after it selects which CLI:

```bash
npx -y -p ideal-harness ideal-harness-guard mcp        # policy / vet / drift / redact / leases / journal — MCP (stdio)
npx -y -p ideal-harness ideal-harness-memory mcp       # code-graph + episodic store + consolidation
npx -y -p ideal-harness ideal-harness-compress mcp     # tool_result compression + CCR
npx -y -p ideal-harness ideal-harness-orchestrate mcp  # ledger / verify / worktrees / spend / loop guard
npx -y -p ideal-harness ideal-harness-web mcp          # web_fetch + web_docs, policy-gated
```

Point a Tier-2 host (Cursor / Cline / Codex / Gemini) at the MCP servers, or call the CLIs directly to invoke policy checks, sandboxing, and skill vetting yourself.

> **Publish-freshness note, stated honestly:** the currently-published `ideal-harness`
> npm package predates this document's `web` module and most of the `guard`/`memory`/
> `orchestrate` capabilities described above (leases, hash-chained journal, team policy,
> `ledger_verify`, worktrees, consolidation) — none of that has been published yet, and
> a stale, orphaned `@ideal-harness/guard` (and sibling scoped packages) from **before**
> the monorepo-to-single-package flatten still sits on the registry pointing at a
> `packages/guard` directory that no longer exists in this repo; don't install those.
> Until a fresh version is published, **"Develop from source" below is the only path
> that actually gets you everything on this page** — `npx` today would run months-old
> code missing the exact fixes this document describes.

### Develop from source (no publish needed)

Working on the harness itself, or running it before the packages are published? Build once and point any project at the local checkout:

```bash
git clone https://github.com/bharat3645/The-Ideal-Harness && cd The-Ideal-Harness
pnpm install
pnpm build                       # all engines (or: pnpm -r run build)
pnpm test                        # node:test, zero test-framework deps
pnpm validate                    # the substrate validates its own repo

pnpm setup                       # wire the harness into THIS directory, or…
pnpm setup /path/to/your/project # …any project — writes .claude/settings.json + .mcp.json
```

`pnpm setup` is idempotent; restart the session and approve the MCP servers once.

### Releasing (maintainers)

```bash
pnpm release:dry   # build + pack everything, no publish — inspect what ships
pnpm release       # build + publish the single `ideal-harness` package to npm (needs npm auth)
```

Tag `vX.Y.Z` to publish via CI (`.github/workflows/release.yml`, needs the `NPM_TOKEN` secret).

## Verification

- **329 unit tests** on `node:test` with zero test-framework dependencies.
- Biome clean, fully type-checked.
- CI runs biome + build + check + test + validate + a skill-threat self-scan on every change.
- **Dogfooded.** The substrate validates its own repo; the code-graph indexes its own source.
- `ideal-harness doctor` — one command, exits non-zero on any wiring problem: dist built, hooks wired, all 5 MCP servers boot and answer `initialize`, policy file parses, active floor mode, journal directory writable. Usable as a CI pre-flight gate, not just a local report.

## Scope, stated plainly

Honesty is the brand, so here is exactly where the harness stands.

- **6 of 9 originally-designed modules ship as real code**: `core`, `guard`, `compress`, `memory`, `orchestrate`, `web`. `skills` (a curated, discoverable third-party library — the vetting gate itself has shipped since v0.1) and a standalone `design`/`eval` module did not ship as separate modules — a `design-critique` skill and `scripts/report.mjs` cover the highest-value slice of each without adding new source modules. Full status: `VISION.md §7`'s roadmap table; the reasoning behind every scope call: `decisions.md`.
- **Clean-room depth is deliberate, with the upgrade path already drawn behind a stable contract:**
  - the code-graph uses regex by default, zero deps; an **optional** tree-sitter tier (TS/JS/TSX/Python) activates when the operator installs `web-tree-sitter` + grammar packages, behind the identical `SymbolNode`/`Edge` contract, and degrades per-file to regex on any parse failure. The graph persists (`<root>/.ideal-harness/memory/graph.json`, workspace-stamped) and re-indexes incrementally — only changed files are re-extracted. More languages on by default, and LSP/SCIP, remain further upgrades.
  - the episodic store is in-memory + JSON-persisted today, with consolidation/decay and provenance (`evidence`) on records; SQLite-FTS5 + vector rerank is still a possible future swap behind the same contract, not required for correctness today.
  - drift-guard's grep tier (`verify_symbol`) still never hard-blocks — grep cannot prove absence. A structural tier (`verify_symbol_structural`) now *can*: it hard-blocks a symbol proven absent only when every source considered was parsed at the tree-sitter tier, capping back to grep authority the moment any source fell back.
  - orchestrate's ledger tasks carry a structural `verify: {command, expect?}` field that `ledger_verify` actually re-runs (policy-gated, sandboxed when the platform supports it) — "done" is a measurement, wired as the reviewer agent's default path, not an assertion it trusts.
  - the `web` module is fetch-only by design (no browser/CDP automation) — see "Integrating into a product or pipeline" above and `decisions.md` D012.
  - the host shim (`core render-skills`) covers skill-*text* portability across Codex/Cursor/Gemini; it does not restore automatic hook-driven enforcement on hosts without a hook system — that remains the honestly-stated Tier-2 gap (`decisions.md` D013).
  - a shared/team policy tier shipped as a git-tracked, PR-reviewed file (`.ideal-harness/team-policy.json`) — deliberately not a hosted or managed service (`decisions.md` D014).
  - named **profiles** (`strict`/`default`/`fast`, `IDEAL_HARNESS_PROFILE`) select the existing floor-mode knob as a bundle — no new enforcement mechanism.

Nothing here is overclaimed. The contracts are fixed; the engines behind them get sharper.

Where this is going: **[VISION.md](VISION.md)** — the full possibility space (personas, per-module upgrade paths, the learning flywheel, anti-goals, and the testable definition of "ideal"), with a per-release shipped/planned status table. **[DESIGN.md](DESIGN.md)** — the 9-layer architecture and source adjudication it is built from. **[decisions.md](decisions.md)** — why each scope call above was actually made, in a durable, append-only ledger (alternatives considered, what lost, and why). **[flow.md](flow.md)** — the actual runtime sequence for every flow mentioned on this page, for anyone wiring the harness into something else.

## License

MIT.
