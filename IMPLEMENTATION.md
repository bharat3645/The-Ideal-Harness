# The Ideal Harness — v0.1 Implementation Plan

Derived from DESIGN.md. v0.1 = `core → guard → compress → memory → orchestrate`. v0.2 = `web → skills → design → eval`.
Status: PLAN. Companion to DESIGN.md.

## v0.1 reality vs this plan (read this first)

This file is the original PLAN; a few items below describe the v0.2 target, not what v0.1 ships. The honest delta:

- **Automatic enforcement (hooks):** only **policy + outbound-secret block** (PreToolUse) and **secret redaction + injection fencing** (PostToolUse) run automatically, plus the SessionStart bootstrap inject. Sandbox, compression, drift-guard, and skill-vetting are real but invoked as **MCP tools / CLIs**, not auto-applied by a hook yet. (Auto-applying sandbox via PreToolUse `updatedInput` and compression via PostToolUse `updatedToolOutput` is the next wiring step.)
- **Memory — structural:** regex extraction, not tree-sitter (v0.2); no MinHash/LSH dedupe yet.
- **Memory — episodic:** **in-memory BM25** with an optional recency tie-breaker. No SQLite-FTS5, no int8-vector, no RRF hybrid (all v0.2). Episodic memory does **not** persist across sessions in v0.1.
- **Memory — faces:** the MCP tools are `add_file`, `query_graph`, `memory_search`, `memory_write`, `reconcile`. There is no `get_node` tool and no automatic SessionStart memory injection (the model calls the tools).
- **Orchestrate — CLI:** exposes `mcp` only. `plan` / `execute` / `resume` exist as library functions (ledger / checkpoint), not CLI subcommands yet.
- **Orchestrate — ledger:** serialize/parse + checkpoint round-trip are implemented and tested, but the module does no file I/O — durable persistence is the **caller's** responsibility (persist the checkpoint blob) until v0.2 wires it.
- **Orchestrate — skills:** `subagent-driven-development` and `brainstorming` ship as SKILL.md. **`autoplan` is not shipped** in v0.1.
- **Compress — context-window statusline (added beyond this plan):** compress also ships a **statusLine meter** not in the original spec — pure, unit-tested budget logic (`analyzeBudget` / `formatStatusline` in `src/budget.ts`) behind a fail-open hook (`hooks/statusline.mjs`) that reads the live context window Claude Code reports (`context_window.context_window_size`) and renders `IH <used>/<window> <pct>%`, advising `/compact` or `/clear` as the window fills. Display + advise only — no hook can force `/compact`.

The contracts are stable; the engines behind them sharpen in v0.2.

## Tech stack (decided)
- **pnpm workspaces + Turborepo + Biome + TypeScript** — mirrors the Voraxx toolchain the user already runs (proven, familiar) and matches the CC-plugin ecosystem (gstack/gsd-core/addyosmani are TS/markdown).
- Single-language for v0.1 coherence: TS everywhere. Tree-sitter via `web-tree-sitter` (WASM) so the code-graph engine stays in-process, no Python sidecar.
- Tests: `node:test` + `node --test` (zero test-framework dep — same policy as Voraxx, respects package release-age rule).
- Each engine package exposes **3 faces**: (a) a Claude Code plugin (skills + hooks), (b) a standalone **MCP server** (Tier-2 portability), (c) a thin **CLI**. Shared core lib underneath.
- Node ≥ 20. ESM. `@modelcontextprotocol/sdk` for MCP servers.

## Repo scaffold (root)
```
package.json            # private root, pnpm workspace scripts
pnpm-workspace.yaml     # packages/*
turbo.json              # build/check/test/lint pipeline (copy Voraxx shape)
biome.json              # single-quote, semicolons, 2-space, 120col (match Voraxx)
tsconfig.base.json      # shared compiler opts; packages override rootDir/outDir
.claude-plugin/marketplace.json   # lists all module plugins
.github/workflows/ci.yml          # biome + tsc + node:test + validate + skillspector self-scan
LICENSE                 # MIT (Q1 — default MIT; Apache-2.0 if patent-grant wanted)
README.md
```
Decision: `git init` standalone repo at `Harness/`; append `Harness/` to `/Users/Bharat/Voraxx/.gitignore` so the parent Voraxx repo never tracks it.

## Package specs (v0.1)

### 1. `packages/core` — substrate (REQUIRED, no deps)
- Plugin loader + `marketplace.json`/`plugin.json` schema + `validate` (pm-skills `validate_plugins.py` idea, in TS).
- Skill templating (`gen-skill-docs` — gstack idea): `SKILL.md.tmpl` → per-host `SKILL.md`; `references/` progressive disclosure (K-Dense).
- Multi-host generation targets: claude/codex/gemini/cursor.
- `using-ideal-harness` bootstrap skill + SessionStart hook that injects it (Superpowers/addyosmani).
- Shared utils: `Result<T,E>`, structured logger, MCP-server harness wrapper, CLI harness wrapper.
- API: CLI `ideal-harness validate|gen-hosts`; lib exports for other packages.
- Tests: schema validation, template rendering, host-gen golden files.

### 2. `packages/guard` — enforcement floor (deps: core)
The crown jewel. Everything deterministic, below the LLM.
- **Policy engine** (omnigent CEL idea): allow/ask/deny rules, deny-wins, fail-closed on unmatched. Config in source control.
- **Permission defaults** (Anthropic): read-only default; `denyRead` `~/.aws`,`~/.ssh`; self-policy write-protection; content-scoped ask (`git push *`); curl/wget not auto-approved.
- **Egress allowlist**: prompt-on-first-use; audit log; no-TLS-inspection caveat noted.
- **Sandbox** (omnigent): wrap exec in Seatbelt (macOS) / bubblewrap (Linux); subprocess env-scrub.
- **Injection defense** (hermes): `<untrusted_tool_result>` wrapping for tool outputs + web/MCP content.
- **drift-guard authority ladder** (gsd-core): grep→tree-sitter→(lsp/scip optional) symbol verification; hard-block hallucinated symbols. v0.1 ships grep+tree-sitter tiers.
- **SkillSpector vetting gate**: scan skills before load. v0.1 = 64-pattern signature DB + homoglyph check + shell-out to OSV for deps + shell-out to semgrep if present (per R2 — do NOT hand-roll taint analysis in v0.1).
- **Secret redaction** (always-on PreToolUse/PostToolUse hook) + **secrets broker** (scoped short-lived injection).
- **HITL ask-gate** = 12-factor #7; gstack-style deterministic PreToolUse preference hook (`<ideal-harness-qid:>`).
- Faces: hooks (PreToolUse/PostToolUse/SessionStart) + MCP server (`policy_check`,`vet_skill`,`verify_symbol`,`broker_secret`) + CLI.
- Tests (heaviest): policy fail-closed matrix, deny-wins, SSRF/egress bypasses (DNS-rebind, redirect, IPv6/decimal), homoglyph detection, redaction, drift-guard hard-block.

### 3. `packages/compress` — context & token compression (deps: core, guard)
- **Input-side** (headroom): deterministic `tool_result` compression — content-detector routing → JSON row-sampling (preserve errors/outliers), log-RLE, diff compaction. **CCR**: drop→cache(SQLite, BLAKE3 key)→`<<ccr:HASH>>` marker→`ccr_retrieve` MCP tool.
- **Frozen-floor**: parse `cache_control`, never recompress cached prefix (the subtle correctness point).
- **Output-side**: caveman terse-mode skill (toggle).
- **Error-compression** (12-factor #9): collapse repeated tool errors → one-line cause + count.
- Secret redaction is NOT here — calls guard's always-on hook.
- Faces: MCP server (`compress_tool_result`,`ccr_retrieve`) + optional proxy mode (point `ANTHROPIC_BASE_URL`) + CLI.
- Tests: per-detector compression + token-gate (reject non-shrinking), CCR round-trip lossless, frozen-floor cache-safety.

### 4. `packages/memory` — structural + episodic (deps: core, guard)
- **Structural** (graphify): `web-tree-sitter` code-graph (start 6 langs: ts/js/py/go/rust/java), confidence labels, MinHash/LSH→Jaro-Winkler dedupe, token-budgeted subgraph retrieval.
- **Episodic** (claude-mem contract): lifecycle hooks → `<observation>` XML (secondary-LLM compress) → SQLite-FTS5; retrieval = **BM25 (native FTS5 rank) + int8-vector hybrid via RRF** (not recency).
- **curator** (hermes): deterministic-first prune + reconcile LLM consolidation claims vs tool-call evidence.
- L2 owns context-overflow persistence; compress only triggers the flush.
- Faces: MCP server (`query_graph`,`get_node`,`memory_search`,`memory_write`) + SessionStart inject (relevance-ranked, not recency) + CLI.
- Tests: graph extraction goldens, dedupe correctness, RRF ranking beats recency baseline, observation parse contract.

### 5. `packages/orchestrate` — control flow (deps: core, guard, memory)
- **subagent-driven-development** (Superpowers): controller + fresh-context-per-task + spec/quality review-gate + fix loop + **file-based artifact handoff** + **durable git-path ledger**.
- **autoplan** (gstack): dual-model consensus gauntlet + 6-principle auto-decision (Mechanical/Taste/User-Challenge).
- **brainstorming HARD-GATE** (Superpowers): no code until approved.
- hermes **self-registering tool registry** + **SHA-256 loop/no-progress guardrails**.
- **Spend governor**: token+$ accounting, per-run hard cap, graceful abort.
- **API retry/backoff/circuit-breaker** (Anthropic 429/overloaded/stream) — distinct from web-fetch retry.
- **Session resume/pause/checkpoint** — crash-recovery from checkpoint.
- HITL escalation routes to guard's ask-gate.
- Faces: skills (subagent-driven-dev, brainstorming, autoplan) + hooks + CLI (`ideal-harness plan|execute|resume`).
- Tests: ledger survives simulated compaction, loop-guard trips, spend-cap aborts, resume-from-checkpoint.

## Memory isolation contract (the boundary; scaffolded in v0.1, persisted in v0.2)

A globally-installed memory module must never leak project A's memory into project B.
We solve this by construction, below the model — not by a query filter someone can forget.

**The contract:**

1. **The project is the storage boundary.** Persistence lives at `<project-root>/.ideal-harness/memory/`
   (gitignored), never in `$HOME`. The filesystem *is* the isolation boundary — there is no shared
   pool to leak from. (v0.1 store is in-memory; v0.2 drops SQLite in at exactly this path.)
2. **The server binds to one workspace for its whole life.** `startMemoryMcp` calls `resolveWorkspace()`
   once at startup (walk up from `cwd` to the `.git`/`.ideal-harness` marker). **No tool accepts a
   parameter that targets another project** — a confused or prompt-injected model cannot reach another
   repo's memory, because the capability does not exist in the API.
3. **Fail closed.** Unresolved workspace, or `IDEAL_HARNESS_MEMORY=off` → **ephemeral** (no persistence),
   never a shared/global store. The memory analogue of guard's deny-wins.
4. **Defence in depth: stamp + assert.** Every record carries its `workspace` key (git remote identity,
   else a path hash). `filterByWorkspace` keeps only the bound workspace's records when a store is loaded,
   so a misplaced or merged DB is inert.
5. **Guard firewall at the boundary.** `memory_write` runs `redactSecrets` before persisting (a secret in
   long-term memory that auto-injects into future sessions is the nightmare we refuse to create);
   `memory_search` wraps recall in `wrapUntrusted` (recalled text may carry injected instructions from a
   past session — treat it as data, not commands).
6. **Two tiers, never conflated.** Project memory (episodic + code-graph) is **project-local** and bound as
   above. A future opt-in **user profile** (preferences/style only — no project specifics, no secrets) may be
   user-global; the contamination danger exists only when project data lands in a global pool, so it never does.

**Shipped in v0.1 (scaffolding):** `workspace.ts` (resolver, key derivation, fail-closed bind), per-record
workspace stamping + `filterByWorkspace`, and the redact-on-write / fence-on-read guard firewall — all tested.
**v0.2 adds:** the SQLite-FTS5 backend writing under `storeDir`, plus `memory list/clear/export` lifecycle tools.
The boundary is already enforced and tested, so persistence drops in behind a proven contract.

## Dependency graph & build order
`core` → `guard` → `compress`, `memory` (parallel, both need core+guard) → `orchestrate` (needs core+guard+memory).

## Milestones
- **M0** scaffold: repo + root config + CI green on empty packages + marketplace.json. `git init`.
- **M1** core: loader+validate+templating+host-gen+bootstrap skill. CI: validate self.
- **M2** guard: policy engine + permission defaults + sandbox + injection wrap + redaction + SkillSpector vet (sig DB + homoglyph + OSV/semgrep shell-out) + drift-guard (grep+treesitter). Heavy test suite.
- **M3** compress: headroom tool_result + CCR + frozen-floor + caveman skill.
- **M4** memory: code-graph + episodic FTS5+RRF + curator.
- **M5** orchestrate: subagent loop + autoplan + spend/retry/resume + loop-guards.
- **M6** v0.1 release: marketplace publish + npm CLIs + multi-host gen + README + docs. Tag v0.1.0.

## Open decisions to confirm at build
- Q1 license: MIT (default) vs Apache-2.0 (patent grant).
- Name: The Ideal Harness (placeholder).
- LLM for episodic compression + autoplan second voice: Claude default; Codex optional (gstack pattern) — gate behind availability.
