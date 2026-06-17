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
  OS sandbox command builder (Seatbelt/bubblewrap) + subprocess env-scrub. PreToolUse /
  PostToolUse hooks deliver automatic enforcement.
- **compress** — deterministic, prompt-cache-safe `tool_result` compression (anomaly-
  preserving JSON sampling, log RLE, stack-trace collapse) with a token gate, a
  Compress-Cache-Retrieve store for lossless recovery, and the caveman output-side
  terse mode.
- **memory** — a structural code-graph with token-budgeted subgraph retrieval, plus an
  episodic store ranked by real BM25 relevance (not recency), kept honest by a curator
  that reconciles claims against tool-call evidence.
- **orchestrate** — the control-flow pillar: durable task ledger, tool registry, loop /
  no-progress guard, spend governor, API retry/backoff, session resume/checkpoint, and
  the subagent-driven-development + brainstorming skills.

### Verification

- 74 unit tests across the five packages (node:test, zero test-framework deps).
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
