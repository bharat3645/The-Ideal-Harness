# The Ideal Harness — v0.1 Implementation Plan

Derived from DESIGN.md. v0.1 = `core → guard → compress → memory → orchestrate`. v0.2 = `web → skills → design → eval`.
Status: PLAN. Companion to DESIGN.md.

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
