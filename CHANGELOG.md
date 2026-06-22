# Changelog

## v0.1.0 — the spine (unreleased)

First release: the five core layers of the harness, each an independently installable
plugin with a Claude Code face (skills/hooks), a standalone MCP server, and a CLI.

### Modules

- **core** — plugin loader, manifest + skill-frontmatter validation, dependency-free
  skill templating + multi-host generation (claude/codex/gemini/cursor), the
  `using-ideal-harness` bootstrap skill + SessionStart injection, and a minimal MCP
  stdio server harness reused by every engine.
- **guard** — the enforcement floor, below the LLM: deny-wins / fail-closed policy
  engine with Anthropic-aligned defaults, prompt-injection wrapping, always-on secret
  redaction, a scoped secrets broker, a skill-vetting scanner (signature DB +
  homoglyph/hidden-char detection), a drift-guard authority ladder (grep tier), and an
  OS sandbox command builder (Seatbelt/bubblewrap) + subprocess env-scrub. The
  PreToolUse hook makes policy + outbound-secret blocking automatic; the PostToolUse
  hook **rewrites** every result (via `updatedToolOutput`) to mask secrets and fence
  injected/external content before the model reads it. Sandbox, vetting, and drift-guard
  ship as MCP tools / CLIs (hook auto-application is roadmapped).
- **compress** — deterministic, prompt-cache-safe `tool_result` compression (anomaly-
  preserving JSON sampling, log RLE, stack-trace collapse) with a token gate, a
  Compress-Cache-Retrieve store for lossless recovery, and the caveman output-side
  terse mode. Also ships a **context-window statusline**: pure, unit-tested budget
  classification (`analyzeBudget` / `formatStatusline`) behind a fail-open Claude Code
  statusLine hook that reads the transcript and reports tokens spent plus the share of
  the model's total context window (`IH 142k/1M 14%`), advising `/compact or /clear` past
  14% (more strongly past 17%). Display + advise only — no hook can force `/compact`.
- **memory** — a structural code-graph with token-budgeted subgraph retrieval, plus an
  episodic store ranked by real BM25 relevance (not recency), kept honest by a curator
  that reconciles claims against tool-call evidence. **Isolation by construction:** the
  server binds to one workspace at startup (no tool can target another project), persistence
  is project-local (`<root>/.ideal-harness/memory/`, never `$HOME`), unresolved scope fails
  closed to ephemeral, records are workspace-stamped, and the guard floor sits on the boundary
  (redact-on-write, fence-on-read). No cross-project memory leakage, enforced below the model.
- **orchestrate** — the control-flow pillar: durable task ledger, tool registry, loop /
  no-progress guard, spend governor, API retry/backoff, session resume/checkpoint, and
  the subagent-driven-development + brainstorming skills.

### Packaging & distribution

- **npm-backed plugin marketplace.** `marketplace.json` sources each plugin from its npm
  package (`@ideal-harness/*`); the published tarball ships `dist/` + hooks + skills, so
  `/plugin install` pulls working code into `${CLAUDE_PLUGIN_ROOT}` — no clone, no build,
  no committed build artifacts. Plugins install at user scope → available in every project.
- Every engine plugin declares its **MCP server in `plugin.json`** (`${CLAUDE_PLUGIN_ROOT}`),
  so installing a plugin wires its tools — no manual `.mcp.json` editing.
- `pnpm release` (build + `pnpm -r publish`) and a tag-triggered `release.yml` workflow;
  `pnpm release:dry` to inspect tarballs without publishing.
- Develop-from-source path: `pnpm setup [projectDir]` idempotently wires any project to one
  built checkout (hooks → `.claude/settings.json`, servers → `.mcp.json`).

### Verification

- 130 unit tests across the five packages (node:test, zero test-framework deps).
- CI: biome + type-check + build + tests + `ideal-harness validate` + skill threat self-scan.
- Dogfooded: the substrate validates its own repo; the code-graph indexes its own source.

### Deferred to v0.2

- **web** — interactive browser daemon + scrape→markdown + multi-source research.
- **skills** — the SDLC skill library (spec → TDD → review).
- **design** — anti-pattern taste linter (PostToolUse hook) + design dials.
- **eval** — feature-gate verification, observability, audit ledger.
- Upgrades behind existing contracts: tree-sitter backend for the code-graph,
  SQLite-FTS5 + int8-vector hybrid for episodic memory, LSP/SCIP tiers for the
  drift-guard, and a semgrep/OSV pass for skill vetting.
