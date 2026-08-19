# Changelog

## v0.3.0 (2026-08-19)

A backlog-clearing pass: 14 ROADMAP issues closed, 3 real bugs found and precisely
documented (not fixed — self-policy-protected code, left for a human), zero new runtime
dependencies. 434 tests; CI (run 32229172072, both Node 21 and 22) shows 430 pass, 0 fail,
4 honestly skipped — the `semgrep`/`osv-scanner` integration tests, absent from the CI
runner. Locally, with both binaries actually installed, those same 4 tests run for real
and fail instead of skipping — not flakiness, they're `test/guard/vet-external.test.ts`
cases exercising real, confirmed bugs in `src/guard/vet/external.ts` (issue #36).

- **web** — DNS-rebinding TOCTOU gap closed with zero new dependencies (`src/web/pinned-request.ts`,
  supersedes `decisions.md` D026 as D038, #5); bracketed IPv6 literals fixed in the SSRF
  guard, plus a second bug found along the way (IPv4-mapped IPv6 in hex-compressed form
  bypassed the guard) (#11).
- **memory** — Go and Rust added to the tree-sitter structural tier (#1, #2); structural
  graph snapshots workspace-stamped, matching the episodic store's existing pattern (#16);
  episodic-store consolidation now auto-triggers every N writes, operator-tunable via
  `IDEAL_HARNESS_MEMORY_CONSOLIDATE_EVERY` (D036, #15).
- **orchestrate** — spend tracking now survives an MCP server restart, fail-closed on
  corrupt/missing state (D037, #14); `worktree_create`'s `baseRef` is `--`-terminated
  against flag injection (#10).
- **compress** — CCR store is now byte-capped with real LRU eviction; the CLI path's
  one-way (lossy) nature is now explicit rather than silently implied (D035, #13).
- **core** — new zero-dependency advisory file lock (`src/core/runtime/lock.ts`) closes
  ROADMAP's own "hardest correctness problem currently open": concurrent MCP processes no
  longer silently clobber each other's persisted state across the ledger, spend checkpoint,
  structural graph, and episodic store (D039, #17).
- **guard** — real semgrep/osv-scanner integration tests, run against the actual binaries
  for the first time (#7) — surfaced 3 real parser/environment bugs in
  `src/guard/vet/external.ts`, tracked in #36 since that file is self-policy-protected.
- **observability** — new `scripts/otel-export.mjs` maps the guard decision journal onto
  OTLP/HTTP JSON spans by hand (stdlib `fetch` + `node:crypto`, no OTel SDK, no new
  dependency) and POSTs to `OTEL_EXPORTER_OTLP_ENDPOINT`, or writes a file for a collector
  to tail if unset. Opt-in, incremental (cursor file), fails open — never touches the
  `PreToolUse`/`PostToolUse` path (D040, #18). Lives in `scripts/`, not `src/guard/`,
  because guard's own self-policy floor denies writing anywhere under `src/guard/`, new
  files included.
- **security posture** — published `SECURITY-COVERAGE.md`, an honest OWASP Agentic
  Applications Top 10 (2026) coverage table: 4 full, 5 partial, 1 out of scope, every
  verdict cited to a real file (#20). Opened #35 (Windows sandbox parity — no code written,
  self-policy-protected).
- **housekeeping** — retired 11 stale GitHub issues (#21-#32) from a since-rejected v2.1-v2.3
  plan that would have added a runtime dependency and duplicated already-shipped/already-
  declined work; corrected `plan.md`'s pre-flatten paths and a CHANGELOG arithmetic error (#12);
  corrected `engines.node` from a false `>=20` to the real `>=21` (`node --test`'s glob support
  needs it) (#9).

## Unreleased

### v2 Phase 2 addendum 3 — closes D027's last two gaps: autoplan, OSV/semgrep (2026-08-11, same day)

Prompted by "use the remaining ones as well... after filling all the gaps perfectly push
the code" — the two confirmed-but-not-fixed gaps from D027 are now closed. 329 tests total
(was 320; +9 from D029 — D028's `plan-critic` is a subagent definition, not testable code,
so it adds none). Full writeup: `decisions.md` D028 (autoplan), D029 (OSV/semgrep).

- **`autoplan`** (D028) — new `agents/plan-critic.md`, a subagent pinned to a different
  model tier (`model: opus`) from the authoring conversation, wired into
  `skills/subagent-driven-development/SKILL.md` as an optional gate for non-trivial plans
  before any implementer runs. Deliberately **not** a second AI vendor/API — this project
  ships zero runtime dependencies and that stays true here: cross-model-tier diversity via
  Claude Code's own native subagent `model` parameter, not a new SDK/API key/cost
  mechanism. Stated explicitly in `decisions.md` D028 what this is and is not, so it's
  never mistaken for a literal second-vendor consensus check.
- **OSV/semgrep shell-out for `vet_skill`** (D029) — new `src/guard/vet/external.ts`:
  `runSemgrep` (offline, bundled ruleset, no network) and `runOsvScanner` (live network to
  osv.dev) shell out when the binaries are present on PATH; absence degrades to
  `available: false`, never a hard failure. Both actual scan invocations are policy-gated
  exactly like `orchestrate/verify.ts`'s `runVerify` gates a verify command — no
  floor-mode softening, since there's no human to answer an `ask` in this unattended path.
  New MCP tool `vet_skill_deep` (directory-based) and CLI `vet --deep <dir>`, alongside
  the existing text-only `vet_skill`. `execCommand`/`ExecResult` moved out of
  `orchestrate/verify.ts` into new `src/guard/exec.ts` so both shell-out call sites share
  one tested Windows-safe process-tree-kill implementation instead of two. Honesty note:
  neither binary is installed in this repo's dev environment, so only the "absence" path
  is exercised against the real tools — the parsing/gating logic is covered via an
  injectable `execFn` (9 new tests), the same pattern D026's `DnsLookupFn` established.

### v2 Phase 2 addendum 2 — full capability audit + SSRF guard (2026-08-11, same day)

Prompted by "fix all the remaining things, and give a final check that every named
source repo's capabilities are actually present" — audited `DESIGN.md §3`'s entire
adjudication table against the shipped code (grep/read, not memory). Found and fixed a
real security gap; confirmed two honest, already-acknowledged gaps remain. Full writeup:
`decisions.md` D025 (resolved)–D027. 320 tests total (was 307).

- **SSRF guard for `web_fetch`** (D026) — `web_fetch` accepted any policy-allowed URL
  with no check against internal/private targets: a model-invokable tool that could be
  steered (prompt injection) into reaching cloud-metadata endpoints, internal admin
  panels, or localhost services. New `src/web/ssrf.ts`: rejects `localhost`, literal
  private/loopback/link-local/reserved IPv4 and IPv6 (incl. IPv4-mapped and the
  169.254.0.0/16 cloud-metadata range), and hostnames that resolve to any private
  address; `fetch.ts` now manually re-validates every redirect hop instead of following
  redirects blindly. Decimal/octal/hex IP-literal bypasses are closed for free by the
  WHATWG URL parser's own normalization. DNS-rebinding is explicitly NOT closed
  (documented, not hidden) — closing it fully needs a custom low-level dispatcher this
  module deliberately doesn't add. 13 new tests.
- **`.claude-plugin/plugin.json`/`marketplace.json` fixed** (D025) — `ideal-harness-web`
  added to `mcpServers`; both descriptions updated. This one required an explicit human
  go-ahead (self-policy-protected path, `CLAUDE.md` says never touch it) — given in this
  same exchange, so it's done.
- **Confirmed, not fixed** (D027): `autoplan` (gstack's dual-model consensus gauntlet)
  never shipped in v0.1 or since — a genuinely different kind of capability (a second
  model as an independent voice), not a bolt-on; and `vet_skill`'s OSV/semgrep shell-out
  (the plan always called for this alongside the signature DB, but only the signature
  DB + homoglyph half was ever built). Both stated honestly rather than silently
  dropped.

- **`policy_check` (guard MCP) ignored operator policy and floor mode entirely**
  (D024) — the single most central Tier-2 integration tool was evaluating against a
  hardcoded default floor with no `resolveOperatorTiers`/`applyFloorMode`, meaning it
  could disagree with what the real interactive hook would decide for the identical
  call. Fixed to match the hook exactly; does not journal (a check, not an action).
- **`scripts/setup.mjs` never wired the `web` MCP server** into a newly-set-up project
  (D023) — the module list predated `web`'s existence. Fixed; verified against a
  scratch directory.
- Doc sweep: `CLAUDE.md`'s module table/paths (was missing `web`, said "four MCP
  servers"), `README.md`'s Tier-1 install instructions (was six separate `/plugin
  install` commands — the marketplace only ever declared **one** plugin; fixed to the
  real single-plugin form), the `using-ideal-harness` bootstrap skill (added `web`
  routing, leases, `ledger_verify`, decision-ledger pointers), `agents/scout.md`
  (mentions `verify_symbol_structural` as the stronger option), `skills/session-
  observer` (documents the `failure` observation type alongside `decision`).

### v2 Phase 2 — the flywheel, scale-out, every host, integration-ready (2026-08-11)

Closes essentially all of `VISION.md §7`'s v0.2 remainder plus v0.3 ("the flywheel"),
v0.4 ("scale-out"), and v0.5 ("every host") roadmap lines, then closes a real
integration-readiness gap found while auditing the result for embedding into a product
or pipeline. `decisions.md` (new) now records the *why* behind every item below in
ADR-lite form; `flow.md` (new) documents the actual runtime sequences. 105 new tests on
top of Phase 1's 205 (310 total from this batch's own arithmetic — corrected 2026-08-19;
the entry previously said 294, which didn't reconcile with either its own inputs or the
307 → 320 → 329 chain the later addenda below state. The exact intervening count isn't
reconstructed here since several docs-only and bugfix commits landed between this batch
and Addendum 2 without each itemizing a running total; 307 is the next verified figure,
in Addendum 2 below), all passing.

**memory — provenance, consolidation, decay, an external notes bridge**
- `Observation` gains an optional `evidence: {overlap, matchedTool?}` field, stamped by
  `memory_write` — provenance on the record, not just in the curator's head
  (`src/memory/episodic/store.ts`).
- New `'failure'` observation type — approaches that didn't work, with evidence, so a
  fresh subagent context doesn't re-walk the same dead end.
- `episodic/consolidate.ts` (new): Jaccard-similarity dedup of near-identical
  same-type observations, then prune-to-cap — exempting `decision`/`failure`/
  `security_alert` types entirely, so memory that only grows doesn't become a landfill,
  without ever dropping the record types that matter most.
- `episodic/persist.ts` (new): on-disk snapshot for the episodic store, mirroring the
  structural graph's persistence contract exactly (atomic write, corrupt-file
  quarantine). New `memory_consolidate` MCP tool.
- `memory/bridge/obsidian.ts` (new, CLI-only — see `decisions.md` D017): export
  observations to / import candidates from a human-owned Obsidian vault
  (`memory vault-export`/`vault-import`).

**guard — audit journal, leases, ratification, ask-fatigue tooling, team policy**
- Hash-chained decision journal: every entry now carries `prevHash`/`hash`
  (`sha256(prevHash + entry)`); `verifyJournalChain()` detects tampering; tolerant of
  legacy pre-chain entries. New `verify-journal` CLI command.
- Capability leases (`src/guard/leases.ts`, new): time-boxed and/or call-count-boxed
  elevated allows, rendered as the highest-precedence policy tier, auto-consumed on use.
  CLI-only grant/revoke — no MCP tool (`decisions.md` D016).
- One-shot ratification: `ratifyShape`/`ratifyFromJournal` propose an allowlist entry
  from a single approved shape, bypassing the usual 3-occurrence threshold, for the
  human to paste in explicitly — same proposals-only contract as the existing loop.
- Ask-fatigue tooling: `summarizeAsks`/`formatAskDigest` (`guard asks` CLI) batches
  pending-style asks into one digest instead of interrupt-per-item.
- Shared team policy tier (`.ideal-harness/team-policy.json`, git-tracked — explicitly
  **not** a hosted service, `decisions.md` D014): `loadTeamPolicy` +
  `composePolicyTiers` generalizes the existing single-source composer to N ordered
  sources. Precedence: leases > personal user policy > team policy > default floor.
- Self-policy deny pattern extended to cover `leases.json` and `team-policy.json` — the
  model cannot edit either through the harness, same as the existing policy file.
- Explain-mode (`[rule=...; operator knobs...]`) now applies uniformly to `ask`
  decisions, not just hard denies — "why am I being asked" is answered the same way as
  "why was this denied."
- **`src/guard/resolve.ts` (new) — the integration-readiness fix.** `ledger_verify` and
  `web_fetch`/`web_docs` were calling their underlying `runVerify`/`fetchPage`/
  `fetchPackageDocs` with no `policyTiers`, silently falling back to the bare default
  floor. Since the default floor asks for both `Bash` and `WebFetch`, and these
  non-interactive paths only ever proceed on an explicit `allow`, this made both tools
  **permanently unusable regardless of how an operator configured policy** — their own
  `ideal-harness.policy.json` rule, a team-policy rule, or a granted lease was never
  consulted. `resolveOperatorTiers()` composes the same leases+user+team+default stack
  `pretooluse.mjs` uses for an interactive call; all three call sites (the hook and both
  MCP handlers) now share one function instead of three drifting copies. See
  `decisions.md` D019 for the full writeup. 5 new tests (`test/guard/resolve.test.ts`).

**orchestrate — real verification, retros, worktree fan-out**
- `src/orchestrate/verify.ts` (new): `runVerify` actually spawns a task's
  `verify.command` — policy-gated (unsoftened, D018), sandboxed via `guard/sandbox.ts`
  on darwin/linux, honestly reported as unsandboxed elsewhere, with a real timeout that
  kills the whole process tree (`taskkill /T /F` on Windows, process-group `SIGKILL`
  elsewhere — `child.kill()` alone left `shell:true` subprocesses running past the
  timeout on Windows). New `ledger_verify` MCP tool and `orchestrate verify <id>` CLI.
- **Verification gates now wired default-on**: `agents/reviewer.md` and the
  `subagent-driven-development` skill call `ledger_verify` by default, falling back to
  a manual re-run only when it can't auto-run — `decisions.md` D011.
- `src/orchestrate/retro.ts` (new): `generateRetro` turns a ledger into a plain summary
  (done/failed/pending counts, verify-coverage percentage, an explicit "done without
  verification, review these" section). `orchestrate retro [outPath]` CLI.
- `src/orchestrate/worktree.ts` (new): `createWorktree`/`listWorktrees`/`removeWorktree`
  — real `git worktree` calls via fixed argv (never a shell string), under
  `.ideal-harness/worktrees/<id>`, so concurrent fanned-out implementers never collide.
  New `worktree_create`/`worktree_list`/`worktree_remove` MCP tools.

**web — new module, scoped deliberately (`decisions.md` D012)**
- `src/web/fetch.ts`: `fetchPage` + `extractReadableText` — `fetch()` plus a
  hand-rolled HTML extractor, three-strategy fallback (semantic region → largest block →
  whole body), no browser/scraping dependency.
- `src/web/docs.ts`: `fetchPackageDocs` — live npm registry metadata/README, grounding
  against stale or hallucinated package API knowledge.
- `src/web/gate.ts`: shared `WebFetch`-rule policy gate so a differently-named MCP tool
  can never be a quiet side door around an operator's existing WebFetch policy.
- New MCP server (`ideal-harness-web`) and CLI (`ideal-harness-web`), `web_fetch`/
  `web_docs` tools, added to `.mcp.json` and `scripts/doctor.mjs`.

**core — multi-host skill rendering actually applied**
- `src/core/cli/render-skills.ts` (new): `core render-skills` walks every skill and
  renders per-host `SKILL.md` variants (already-designed templating in
  `core/skills/hosts.ts`, never previously invoked against real skills). Scoped
  explicitly to skill *text* — not hook portability (`decisions.md` D013).

**new skills** — `grill-with-docs` (pre-brainstorm clarification → `CONTEXT.md`, grounds
against `web_docs`/`web_fetch` before planning), `tdd` (red/green/refactor, composable
with a ledger task's `verify`), `design-critique` (pre-emit self-critique + slop-gate
checklist, folded into one skill rather than a new `design` source module).

**scripts — an observe report, a project doctor**
- `scripts/report.mjs` (new): static, self-contained HTML dashboard reading the
  journal/ledger/graph/episodic JSON already on disk — no server, no framework
  (`decisions.md` D015). `pnpm run report`.
- `scripts/doctor.mjs` extended for the 6th module and 5th MCP server.

**decisions.md, flow.md (new)** — an ADR-lite decision ledger (why every scope call in
this changelog was made, in a template with alternatives-rejected and status/supersedes)
and a runtime-flow map (Mermaid sequence/flow diagrams for the hook loop, tier
resolution, ledger lifecycle, memory read/write/persist, web fetch, the learning loop,
and skill vetting) — both plain git-tracked files, no new subsystem (`decisions.md`
D020).

**benchmark** — `bench/benchmark.mjs` now indexes via `addFileAuto` (exercising the
tree-sitter tier, not the pre-tree-sitter regex-only path) and reports the tier mix.
Re-run against this repo's own `src/` (the original external target is unavailable in
this environment) and folded into `BENCHMARK.md` as a dated, clearly-labeled addendum
that preserves the original numbers unchanged — including one deliberately unflattering
result (a retrieval query that returns zero matches on the new target), reported exactly
as plainly as the good ones.

### v2 Phase 1 — trust, scale, anti-hallucination

Closes the highest-leverage slice of `VISION.md`'s v0.2 roadmap, sharpened by a fresh audit
against ~26 external harness/skill repos (most already adjudicated in `DESIGN.md`; the newly
researched ones — task-observer, i-have-adhd, find-skills, scrapling, mattpocock/skills,
Nutlope/hallmark, claude-code-setup, obsidian, astryx — are now recorded there too).

- **memory — optional tree-sitter structural tier** (`src/memory/structural/treesitter.ts`).
  Same `SymbolNode`/`Edge`/`Extraction` contract as the regex tier; TS/JS/TSX/Python via
  `web-tree-sitter` WASM. Zero hard runtime dependency — the operator opts in
  (`pnpm add -D web-tree-sitter tree-sitter-typescript tree-sitter-javascript tree-sitter-python`,
  devDependency here for real integration tests, ~4MB of actual `.wasm` payload, not the
  50MB+ unpacked package size which includes unused native prebuilds). Any parse failure
  degrades per-file to the regex tier, never a hard failure.
- **memory — on-disk persistence + incremental indexing** (`src/memory/structural/persist.ts`).
  `CodeGraph.serialize`/`parse` (pure) + fail-open, atomic (tmp-then-rename) fs read/write,
  quarantining a corrupt snapshot instead of looping the failure. `CodeGraph.addFileAuto` hashes
  content and skips re-extraction when unchanged, and REPLACES (never accumulates) a changed
  file's nodes/edges — fixed a latent duplicate-imports bug in the process. `startMemoryMcp`
  resumes from `<root>/.ideal-harness/memory/graph.json` (workspace-stamped, same isolation
  contract as the episodic store) instead of cold-indexing from zero every session — the actual
  lever for large-codebase scale.
- **guard — drift-guard's authority ladder actually reaches `treesitter`.** New
  `verifySymbolStructural`/`verifyPlanStructural` (`src/guard/drift.ts`) verify against
  pre-extracted, tier-tagged symbol data instead of re-deriving with a content regex. Absence is
  provable — and therefore hard-blocks — only when EVERY source considered was extracted at the
  tree-sitter tier; a single regex-tier fallback anywhere in the set caps the whole verdict back
  to grep authority. New MCP tool `verify_symbol_structural`.
- **orchestrate — verification-first ledger tasks.** `LedgerTask` gains an optional
  `verify: {command, expect?}` field (`src/orchestrate/ledger.ts`), round-tripped through
  serialize/parse and the `ledger_add`/`ledger_update` MCP tools. `agents/implementer.md`,
  `agents/reviewer.md`, and the `subagent-driven-development` skill now read/write it explicitly
  instead of relying on prose in a brief — "done" is a measurement, not an assertion.
- **`ideal-harness doctor`** (`scripts/doctor.mjs`, `pnpm run doctor`). Checks: dist built, hooks
  wired, MCP servers registered, all 4 servers actually boot and answer `initialize`, user policy
  file parses, active floor mode, `.ideal-harness/` writable. Found and fixed a real cross-platform
  bug during its own first run: dynamic `import()` of an absolute path needs a `file://` URL on
  Windows.
- **guard — profiles** (`src/guard/profiles.ts`): `strict`/`default`/`fast` via
  `IDEAL_HARNESS_PROFILE`, a named bundle over the existing `floorMode` knob — no new enforcement
  mechanism. Precedence: bypass signals > explicit `IDEAL_HARNESS_FLOOR_MODE` > profile > soft
  default. An unrecognized profile name fails to `strict`, same rule `floorMode` already applies
  to a broken `FLOOR_MODE` value. (VISION §4.3 also names an "explain verbosity" axis; no such
  knob exists yet, so profiles honestly bundle only what's real today.)
- **Two new skills.** `skills/session-observer/` (task-observer-inspired: watches a session for
  corrections and repeated patterns, records them as episodic observations for later
  human-reviewed proposals — generalizes `guard learn` beyond Bash approvals). `skills/focus/`
  (i-have-adhd-inspired: answer-first, numbered, state-restated output — a structure axis,
  orthogonal to `caveman`'s token-compression axis; the two compose). Both pass `vet_skill` clean.
- **`ideal-harness-memory query`** now indexes via `addFileAuto` and reports the tier mix
  (`N/M files at tree-sitter tier`) instead of silently staying on the regex tier forever.
- 35 new tests (170 → **205**), all passing; build/check/biome/validate/doctor all green.

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
  *(Historical, accurate for v0.1.0: the monorepo flattened after this — see `DESIGN.md`'s
  2026-08-11 historical note — into one `ideal-harness` npm package with six bins. The
  scoped `@ideal-harness/*` package names above no longer exist; `README.md`'s install
  instructions describe the current single-package form. `decisions.md` D022/D025 record
  the post-flatten fixes.)*
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
