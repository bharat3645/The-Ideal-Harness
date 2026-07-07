# Changelog

## Unreleased

### guard — softened for good: soft floor is now the DEFAULT

- **Default floor mode is `soft`**: denies downgrade to asks, so out of the box nothing is
  hard-blocked — the human decides. This mirrors Claude Code's own default posture (no hard
  denies unless configured). `IDEAL_HARNESS_FLOOR_MODE=enforce` restores hard denies; an
  explicitly set but unrecognized mode value fails strict (to `enforce`), never soft.
- **Rule precedence corrected to deny > allow > ask** (was deny > ask > allow) — Claude Code's
  own model: an explicit allow now beats a catch-all ask, which is what lets narrow default
  allows coexist with the broad `ask-bash`. Deny stays absolute; unmatched still fails closed.
- **Read-only git allowed by default** (`git status|log|diff`): anchored pattern rejecting
  chaining/redirection/substitution metacharacters, credential-path args, and `--output`.
- **Decision journal**: every PreToolUse decision (tool, redacted subject, action, rule, mode,
  softened flag) appends to `.ideal-harness/guard-journal.jsonl` — project-local, fail-open,
  `IDEAL_HARNESS_JOURNAL=off` kill-switch. Hard denies now name their rule id and the operator
  knobs in the decision reason (explain-mode).
- **Self-learning loop v1** (`ideal-harness-guard learn`): reads the journal, finds Bash command
  shapes with ≥3 approvals (never shapes that ever hit a deny or softened deny; never Edit/Write;
  never egress-secret asks), and prints narrow anchored allow-rule *proposals* for the human to
  paste into `ideal-harness.policy.json`. Proposals only — the harness never applies them.

### agents — the orchestrate flow gets its cast

- `agents/scout.md` (read-only locator, file:line tables), `agents/implementer.md`
  (one task, verification-first, reports faithfully), `agents/reviewer.md` (gate that re-runs
  the implementer's verify command instead of trusting the claim). Symlinked into
  `.claude/agents/` for dogfood discovery; ship with the plugin for installs.
- Skills updated to route through them (`subagent-driven-development`, `using-ideal-harness`).

### wiring

- `.claude/settings.local.json` added: the compress statusline was documented as wired but
  wasn't in this checkout. All four MCP servers verified booting via initialize handshake.

### guard — operator-tunable floor

The floor stays deterministic and below the model; the *human operator* now has sanctioned
knobs to soften or rewrite it, all loud on stderr and none reachable by the model:

- **Floor modes** (`floorMode` / `applyFloorMode` in `src/guard/bypass.ts`): `enforce`
  (default) / `soft` (`IDEAL_HARNESS_FLOOR_MODE=soft` — every deny downgrades to ask, the
  human decides instead of the harness) / `bypass` (allow-all; existing
  dangerously-skip-permissions signals, plus `IDEAL_HARNESS_FLOOR_MODE=bypass`).
- **User policy file** (`src/guard/policy/load.ts`): `ideal-harness.policy.json` at the
  project root and/or `~/.config/` adds an operator rule tier evaluated *above* the default
  floor (`evaluateTiered` — first tier with a match decides; deny-wins inside a tier;
  nothing matched still fails closed to ask), and `disable` drops default rules by id —
  deny rules included, with a `floor softened` warning. The file is itself covered by the
  self-policy deny pattern, so only the human can edit it through the harness. A broken
  file is ignored with a warning and never widens the floor; `IDEAL_HARNESS_USER_POLICY=off`
  is the kill-switch.
- **Bootstrap skill tuned for the Claude 5 (Fable) era**: decision-making principles
  (act on sufficient information, verify before relying, lead with the outcome, report
  faithfully) split from harness mechanics; denials now route the operator to the right
  knob instead of being a dead end.

## v0.1.0 — the spine (unreleased)

First release: the five core modules of the harness, shipped as a single npm package
(`ideal-harness`) with a Claude Code plugin face (skills/hooks), four standalone MCP
servers, and five CLIs.

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
