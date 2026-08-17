# Decisions — The Ideal Harness's own Decision Ledger

> Structured records of "we chose X over Y because Z," so a future session (human or
> agent) can answer *why does this exist* without re-reading a year of history or
> re-litigating a settled call. This is `VISION.md §3.2`'s own highest-value unbuilt
> memory type — "Auto-extract 'chose X over Y because Z' moments into durable, citable
> records... the single highest-value memory type for long-lived projects" — closed here.

## Why a flat file, not a database

This is a plain, git-tracked markdown file — not a new module, not a new persistence
layer, not an MCP tool. That's deliberate, not a shortcut:

- **It stays lightweight.** One more file costs nothing to load, index, or run; a new
  subsystem costs a schema, a store, a query API, and tests for all three. The project's
  own anti-overlap rule (`DESIGN.md §6`) says one mechanism per capability — and "durable,
  reviewable, diffable record of a choice" already has a mechanism: a file in git.
- **It's already queryable the way everything else here is.** `Grep`/`Read` (or
  `memory_search` once a session's decisions are also written as `type: 'decision'`
  episodic observations, see below) find an entry by topic exactly as they find anything
  in `DESIGN.md` or `CHANGELOG.md`. No new index to keep in sync.
- **PRs review it like code.** A decision that changes gets a diff, not a silent
  overwrite in a JSON blob nobody reads.
- **It does not duplicate the episodic store.** `memory`'s `EpisodicStore` already has a
  `'decision'` `ObservationType` (v0.1) for session-scoped, ephemeral "we decided X right
  now" notes captured via `memory_write` — searchable by BM25, workspace-isolated,
  subject to consolidation/decay. **This file is for the other tier**: durable,
  project-level architecture decisions that should survive consolidation forever and
  that a human deliberately committed. Use `memory_write(type:'decision')` for the
  former; add an entry here for the latter. Neither replaces the other; nothing is
  ingested from one into the other automatically — that automation would be exactly the
  kind of silent, ever-growing coupling this project's honesty rule refuses.

## Format

```
## D0xx — <short title>
- **Date:** YYYY-MM-DD
- **Status:** active | superseded by D0yy | historical
- **Decision:** what was chosen, one or two sentences.
- **Why:** the actual reasoning — a constraint, a measured tradeoff, a prior incident.
- **Alternatives rejected:** what else was on the table and why it lost.
- **Home:** the module/file this decision governs.
```

New entries append at the end (chronological); a later decision that changes an earlier
one adds a new entry and marks the old one's `Status` as superseded — the old entry is
never deleted or edited to look like it always said the new thing.

---

## D001 — Claude-Code-native substrate, MCP-portable core, two honest tiers
- **Date:** 2026-06-17
- **Status:** active
- **Decision:** Build deep on Claude Code (hooks, automatic enforcement) as Tier 1; every
  engine also ships as a standalone MCP server + CLI as Tier 2 for any MCP-capable host.
- **Why:** A multi-backend runtime chassis (host other agents' loops) was on the table
  and rejected — it can't get the *automatic* hook enforcement right on someone else's
  loop, so it would either lie about what it guarantees or reimplement half of Claude
  Code. Stating the tier boundary honestly beats pretending portability is free.
- **Alternatives rejected:** a multi-backend runtime hosting other agents (`omnigent`'s
  chassis) — kept its policy engine + sandbox as portable primitives, dropped the chassis.
- **Home:** `DESIGN.md` intro, `README.md` "Universality, told honestly."

## D002 — Anti-overlap: one mechanism per capability
- **Date:** 2026-06-17
- **Status:** active
- **Decision:** Every capability gets exactly one chosen implementation; rejected
  alternatives are named in `DESIGN.md §6`, not silently dropped.
- **Why:** The user's starting pile (gstack + caveman + claude-mem + graphify + ~700
  connector skills) had 2-4 competing answers to the same question (two memory systems,
  two compression stories). That's the disease this project exists to cure.
- **Alternatives rejected:** letting each source repo's mechanism coexist "for
  flexibility" — rejected because it reproduces the exact overlap problem.
- **Home:** `DESIGN.md §6` (Anti-Overlap Adjudication table).

## D003 — The floor is deterministic code below the model, never a prompt
- **Date:** 2026-06-17
- **Status:** active
- **Decision:** Every safety/scope rule is a `PreToolUse`/`PostToolUse` hook or an MCP
  tool the host calls — never an instruction the model is asked to follow.
- **Why:** A rule the model can reason its way around is a suggestion, not a property.
  OWASP LLM06 (excessive agency) requires structured authorization, not prompt-level trust.
- **Alternatives rejected:** system-prompt-level guardrails (what most "harnesses" ship).
- **Home:** `src/guard/`, `hooks/pretooluse.mjs`, `hooks/posttooluse.mjs`.

## D004 — Deny-wins, fail-closed; precedence corrected to deny > allow > ask
- **Date:** 2026-07-07 (correction)
- **Status:** active
- **Decision:** Rule precedence is deny > allow > ask > default-ask, matching Claude
  Code's own model — an explicit allow beats a catch-all ask; unmatched still fails
  closed to ask.
- **Why:** The original deny > ask > allow ordering meant a narrow default allow (e.g.
  read-only git) could never coexist with a broad `ask-bash` catch-all — the catch-all
  always won. Fixing the order is what let `git status|log|diff` become a real default
  allow without opening Bash generally.
- **Alternatives rejected:** keeping ask above allow and special-casing exceptions —
  rejected as exactly the kind of implicit special-casing the floor must not have.
- **Home:** `src/guard/policy/engine.ts`.

## D005 — Soft floor by default; enforce/bypass are explicit operator opt-ins
- **Date:** 2026-07-07
- **Status:** active
- **Decision:** Out of the box, every deny downgrades to an ask (`soft` mode) — nothing
  is hard-blocked; the human decides. `IDEAL_HARNESS_FLOOR_MODE=enforce` restores hard
  denies for untrusted repos / unattended runs; `bypass` mirrors Claude Code's own
  `--dangerously-skip-permissions`.
- **Why:** Mirrors Claude Code's own out-of-the-box posture (no hard denies unless
  configured). A harness that surprises a new user with hard blocks on day one teaches
  them to reach for `--dangerously-skip-permissions` globally instead of trusting the
  floor's granularity.
- **Alternatives rejected:** `enforce` as the default — rejected as friction that trains
  people away from the floor rather than toward using its dials.
- **Home:** `src/guard/bypass.ts`.

## D006 — Self-modification refused; proposals-only, human ratifies
- **Date:** 2026-07-07
- **Status:** active
- **Decision:** The harness may observe outcomes and *propose* config changes (allowlist
  entries, retro findings); no component ever applies a change to its own permissions or
  policy. A human always ratifies.
- **Why:** Confirmed independently by the 2026-08-11 external comparison review (see
  D021): the alternative — evaluation-gated self-improvement — "creates an accountability
  gap." This project's own `VISION.md` anti-goal #3 reached the same conclusion first.
- **Alternatives rejected:** auto-apply above a confidence threshold, evaluation-gated
  self-modification (the shape the external comparison's "other AI vision" proposed).
- **Home:** `src/guard/learn.ts`, `VISION.md §6.3`.

## D007 — Not a SaaS: zero runtime deps, local-first, air-gap capable
- **Date:** 2026-07-07
- **Status:** active
- **Decision:** No hosted service, no required network call, no cloud state, ever.
  Persistence is project-local (`.ideal-harness/`); the only network calls are the
  explicitly gated `web` module's fetches.
- **Why:** Protects the offline persona (`VISION.md §2`) and keeps the trust model
  simple — nothing to breach that isn't already on the machine running the agent.
- **Alternatives rejected:** a managed/hosted policy or memory tier — the "team" and
  "managed policy" needs are met with a **git-tracked file** instead (see D014).
- **Home:** `VISION.md §6.2` (anti-goals).

## D008 — BM25 as the deterministic default for episodic memory, not embeddings
- **Date:** 2026-06-17
- **Status:** active
- **Decision:** Episodic recall ranks by real BM25 relevance (SQLite-FTS5-equivalent
  algorithm, in-memory for v0.1), never by recency alone and never by a vector API as the
  source of truth. A vector rerank stays an optional, additive layer, never load-bearing.
- **Why:** `claude-mem` (the source repo this pattern is drawn from) ships FTS5 but sorts
  by recency anyway — that throws away a working relevance signal. A vector store also
  reintroduces a network/API dependency this project refuses (D007).
- **Alternatives rejected:** pure recency ordering; a vector-only store.
- **Home:** `src/memory/episodic/`.

## D009 — Code graph: regex tier by default, tree-sitter as an explicit opt-in
- **Date:** 2026-08-10
- **Status:** active
- **Decision:** `CodeGraph` ships zero-dependency regex extraction by default; an
  operator who installs `web-tree-sitter` + grammar packages gets a structural tier
  behind the *identical* `SymbolNode`/`Edge` contract. Any parse failure degrades
  per-file to regex — never a hard failure.
- **Why:** Zero-deps-by-default is a property to protect (D007's sibling for the memory
  layer); tree-sitter's WASM payload (~4MB, not the 50MB+ package) is real weight that
  should be opt-in, not forced on every install.
- **Alternatives rejected:** tree-sitter as a hard dependency; a Python LSP sidecar
  (rejected — keeps everything in-process, no subprocess protocol to maintain).
- **Home:** `src/memory/structural/treesitter.ts`.

## D010 — Drift-guard hard-blocks only on proof, never on absence-by-grep
- **Date:** 2026-08-10
- **Status:** active
- **Decision:** The grep-tier `verify_symbol` never hard-blocks a missing symbol — grep
  cannot prove absence, only non-match. `verify_symbol_structural` *can* hard-block, and
  only when **every** source considered was parsed at the tree-sitter tier; one
  regex-tier fallback in the set caps the whole verdict back to grep authority.
- **Why:** This is the honesty rule applied to safety mechanics: a false hard-block
  (claiming a real symbol doesn't exist because grep's pattern missed it) is worse than
  under-blocking, because it teaches the human to distrust and route around the guard.
- **Alternatives rejected:** hard-blocking on any grep miss — rejected as overclaiming a
  proof the grep tier cannot make.
- **Home:** `src/guard/drift.ts` (`AUTHORITY_ORDER`, `ABSENCE_PROOF_FLOOR`).

## D011 — "Done" is a measurement, not an assertion
- **Date:** 2026-08-10 (added), 2026-08-11 (wired default-on)
- **Status:** active
- **Decision:** A ledger task's `verify: {command, expect?}` is actually re-spawned by
  `ledger_verify`/`runVerify` — policy-gated, sandboxed when available — and the task's
  status is set from the real exit code, not from a reviewer agent's reading of an
  implementer's claim. The `reviewer` agent and `subagent-driven-development` skill now
  call `ledger_verify` **by default**, falling back to manual re-run only when it can't
  auto-run.
- **Why:** Named in `VISION.md §3.4` as this section's own highest-leverage call before
  it was built. An LLM re-reading another LLM's "tests pass" claim and trusting it is not
  verification; it's a second unverified claim.
- **Alternatives rejected:** trusting the implementer's self-report (the pre-2026-08-10
  behavior); an always-sandboxed requirement (rejected — Windows/other platforms have no
  OS sandbox, and refusing to verify there defeats the point on most real dev machines;
  handled instead by reporting `sandboxed:false` honestly, never hidden).
- **Home:** `src/orchestrate/verify.ts`, `agents/reviewer.md`.

## D012 — `web` scoped to fetch-only; no browser daemon
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** The `web` module is `fetch()` + a hand-rolled HTML text extractor. No
  headless browser, no Playwright/Puppeteer dependency, no warm-Chromium daemon.
- **Why:** `DESIGN.md`'s own risk log (§10, R3) already flagged the browser daemon as
  the single biggest build in the entire original roadmap (~24K LOC in the reference
  implementation). A real browser dependency also breaks D007/D009's zero-deps-by-default
  property for every user, not just the ones who need it. The "adaptive extraction"
  leverage (scrapling's self-healing-selector idea) is retained clean-room, without a DOM
  engine, via a three-strategy text-yield fallback.
- **Alternatives rejected:** a CDP-based interactive daemon (`chrome-devtools-mcp`
  pattern) — still roadmapped, not ruled out forever, just not this pass.
- **Home:** `src/web/fetch.ts`.

## D013 — Host shim scoped to skill-text rendering, not hook portability
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** `core render-skills` generates per-host `SKILL.md` variants (Codex,
  Cursor, Gemini) from one source skill. It does **not** attempt to make PreToolUse/
  PostToolUse-style automatic enforcement portable to hosts without a hook system.
- **Why:** Skill *text* is host-agnostic by construction (it's a prompt). Automatic
  enforcement is not — it requires the host to actually call a hook at the right moment,
  which most Tier-2 hosts don't expose. Claiming portability there would be exactly the
  overclaim `VISION.md §6.6` refuses ("no 'universal' without the Tier-2 caveat spoken").
- **Alternatives rejected:** a full host-loop-wrapping shim that intercepts any
  MCP-capable agent's tool calls — this is `VISION.md §3.5`'s "host shim (the Tier-2
  endgame)," explicitly still "speculative until scoped," not attempted here.
- **Home:** `src/core/cli/render-skills.ts`.

## D014 — Team/managed policy tier is a git-tracked file, not a hosted service
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** `.ideal-harness/team-policy.json` — same rule shape as
  `ideal-harness.policy.json` — is a plain committed file, reviewed through normal PRs.
  Precedence: capability leases > personal user policy > team policy > default floor.
- **Why:** Direct application of D007. "Managed policy tier" (`VISION.md §2`, the
  enterprise persona) does not require a server — a file every team member already pulls
  via git satisfies "centrally agreed, hard to silently diverge from" without adding any
  infrastructure or trust boundary beyond git itself.
- **Alternatives rejected:** a hosted config service pushing policy to clients at
  runtime — rejected outright as the exact SaaS/cloud-state anti-goal D007 protects.
- **Home:** `src/guard/policy/load.ts` (`loadTeamPolicy`, `composePolicyTiers`).

## D015 — Observe layer is a static, generate-on-demand HTML report
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** `scripts/report.mjs` reads the journal/ledger/graph/episodic JSON already
  on disk and renders one self-contained, inline-CSS HTML file. No server, no
  auto-refresh, no framework dependency.
- **Why:** `VISION.md §4.1` calls for the *event journal first, the dashboard second* —
  the journal (guard) and ledger (orchestrate) already existed; this closes the
  "nothing renders them" gap with the smallest possible surface. A live server is a
  process to keep running, a port to secure, and infrastructure D007 refuses.
- **Alternatives rejected:** a long-running local web server with auto-refresh —
  deferred; nothing here rules it out later, it's just not required to answer "what
  happened," which a regenerate-on-demand static file already answers.
- **Home:** `scripts/report.mjs`.

## D016 — Capability leases: CLI-grant only, never an MCP tool
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** `lease grant`/`lease revoke` exist only as CLI commands. `lease list`
  (read-only) is the only lease-related MCP-safe surface — actually, list is also
  CLI-only in the current build; no lease capability is model-invocable at all.
- **Why:** A model-invokable "grant myself elevated access, even time-boxed" call would
  defeat the entire point of the floor being human-owned (D003, D006). The asymmetry is
  the design: a lease *feels* safer to a human granting it because it expires, so humans
  grant it more honestly than a permanent rule — but only if a human is the one granting it.
- **Alternatives rejected:** an MCP tool letting an agent request/self-grant a
  short-lived lease with human "co-sign" after the fact — rejected as still allowing the
  model to act before ratification, inverting who's sovereign.
- **Home:** `src/guard/leases.ts`.

## D017 — Obsidian bridge: CLI-only export/import, no MCP tool
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** `memory vault-export`/`vault-import` are CLI commands, dry-run by
  default on import. No MCP tool wraps them.
- **Why:** Same asymmetry as D016, applied to data instead of capability: exporting
  project memory into a human-owned, cross-project vault is a data-boundary-crossing act
  that should require a human at the keyboard, not a model deciding to exfiltrate context
  into a different store on its own initiative.
- **Alternatives rejected:** an MCP `vault_export` tool gated by policy like `web_fetch`
  — rejected because policy gates *whether* an action is allowed, not *whose idea it was*;
  crossing a memory boundary is exactly the kind of act `VISION.md §3.2` says "isolation
  stays the default forever; crossing is a visible human act."
- **Home:** `src/memory/bridge/obsidian.ts`.

## D018 — Any MCP tool doing its own I/O must gate itself like the native tool would
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** An MCP tool handler that performs a real OS action outside the
  interactive `PreToolUse` hook's reach (spawning a subprocess, fetching a URL) must
  evaluate that action against the *same* policy rule tool-name the equivalent native
  tool would use (`'Bash'`, `'WebFetch'`), with no floor-mode softening, and refuse
  (never execute) on anything short of an explicit `allow`.
- **Why:** `ledger_verify`'s subprocess spawn and `web_fetch`/`web_docs`'s network fetch
  both bypass the hook that normally intercepts `Bash`/`WebFetch` calls — without this
  rule, a differently-named MCP tool becomes a silent side door around the floor.
- **Alternatives rejected:** trusting the MCP tool's own judgment / no gating at all
  (obviously rejected); softening via floor mode (rejected — a `soft`-mode deny→ask
  downgrade means nothing here, since there's no human to answer an `ask` at this layer;
  only an explicit `allow` may proceed).
- **Home:** `src/orchestrate/verify.ts`, `src/web/gate.ts` — the pattern established
  first in `verify.ts`, then reused identically in `web/gate.ts`.

## D019 — MCP tool handlers must resolve the operator's REAL tier stack, not a hardcoded default
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** `ledger_verify` and `web_fetch`/`web_docs` now compose leases + personal
  user policy + team policy + defaults (`resolveOperatorTiers()`, `src/guard/resolve.ts`)
  before gating — the exact same tier stack `hooks/pretooluse.mjs` composes for an
  interactive call — instead of the bare `[DEFAULT_RULES]` they used before.
- **Why:** D018 correctly required gating; it did **not** require gating against the
  *operator's actual configuration*. The default floor asks for both `Bash` and
  `WebFetch`, and an `ask` at this layer can only ever mean refuse (no one to prompt) —
  so with only `[DEFAULT_RULES]` in play, these tools were **permanently unusable no
  matter how an operator configured policy**: their own `ideal-harness.policy.json`
  allow rule, a team-policy allow rule, or a granted lease was silently never consulted.
  That directly undermines "integrate this into a pipeline that can act on the
  operator's behalf" — the operator had no path to ever grant real capability. Found
  while auditing the harness for product/pipeline integration-readiness; the composition
  logic was already written three times with drift risk (`pretooluse.mjs` inline, plus
  the two gaps), so it was extracted into one function all three now share.
- **Alternatives rejected:** leaving `ledger_verify`/`web_fetch` "ask-only, human runs it
  manually" permanently — rejected because it silently defeats the entire purpose of
  those two tools existing as autonomous, policy-respecting alternatives to a human
  re-running commands by hand; also rejected: giving each handler its own bespoke tier
  composition (drift risk — see this decision's own discovery).
- **Home:** `src/guard/resolve.ts` (new), `src/orchestrate/runtime/mcp.ts`,
  `src/web/runtime/mcp.ts`, `hooks/pretooluse.mjs` (deduplicated to call the same function).

## D020 — This decision ledger is a file, not a subsystem
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** Close `VISION.md §3.2`'s "decision ledger" gap with `decisions.md` — this
  file — rather than a new store/query API/MCP tool.
- **Why:** See "Why a flat file, not a database" at the top of this document. The
  capability that actually mattered (durable, citable, queryable-by-topic records of
  *why*) does not require new infrastructure; it requires discipline about writing
  entries down, which a template and a habit provide more honestly than a database would.
- **Alternatives rejected:** a `decision_ledger` MCP tool + JSON store mirroring
  `leases.ts`'s shape — rejected as the exact kind of "add a mechanism because we can"
  the anti-overlap rule (D002) exists to prevent; a git-tracked file is already durable,
  diffable, human-reviewable, and greppable/`memory_search`-able (once cross-referenced
  from an episodic `'decision'` observation) with zero new code.
- **Home:** this file.

## D021 — External comparison review: 5 of 6 identified gaps were already closed
- **Date:** 2026-08-11
- **Status:** active (informational — records an external finding, not a design choice)
- **Decision:** An independently-authored comparison document (`ideal_harness_comparison.md`,
  written 2026-08-10 against the harness as of that date) evaluated this project against
  a maximal "Autonomous Project OS" vision from a different AI. It confirmed the harness's
  core philosophy (enforcement-below-the-model, honesty-as-release-criterion, anti-overlap,
  proposals-only learning, honest multi-host tiers) as correct and identified 6 concrete
  gaps. By the time this entry was written (one day later, after the `v2 Phase 2`
  session), 5 were already closed: failure memory (`ObservationType: 'failure'`),
  consolidation/decay (`episodic/consolidate.ts`), worktree fan-out
  (`orchestrate/worktree.ts`), an observe report (D015), and the decision ledger itself
  (D020, this file). The 6th — model routing — remains correctly out of scope
  (host-dependent, marked speculative in `VISION.md §3.4`, not a gap).
- **Why recorded here:** Independent validation is worth keeping as a record — both that
  the anti-goals (market-research engine, full self-modification, 15 permanent agents,
  SaaS state, "project immortality" as a marketing claim before the infrastructure
  exists) were confirmed correct by an outside read, and that the one thing flagged as
  genuinely missing is exactly what got built.
- **Home:** this file; source document kept outside this repo (an IDE-local research
  note, not itself part of the harness).

## D022 — README's Tier-2 npm instructions were stale after the monorepo flatten; publishing is not "readiness"
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** Fixed `README.md`'s Tier-2 quickstart to use the real current package
  shape (`npx -y -p ideal-harness <bin>` — one package, six bins) instead of the old
  `npx -y @ideal-harness/<module>` scoped-package form, and added an explicit note that
  the currently-published `ideal-harness` npm package (checked live: version `0.1.0`)
  predates the `web` module and most of this session's `guard`/`memory`/`orchestrate`
  work, and that a stale, orphaned `@ideal-harness/guard` (and presumably sibling
  scoped packages) from before the flatten-to-single-package refactor still resolves on
  the registry, pointing at a `packages/guard` directory that no longer exists in this
  repo.
- **Why:** Found while answering "is this ready to integrate" honestly instead of
  assuming — the README's own Tier-2 install path was checked against the live npm
  registry, not just read. A user following the pre-fix README today would either hit a
  404 (`@ideal-harness/web` was never published) or silently run months-stale code
  missing every fix in this changelog (`@ideal-harness/guard`) — the exact opposite of
  "integration-ready." Internal build/test/lint/doctor all passing (D019 and everything
  before it) verifies the *source* is coherent; it says nothing about whether the
  *published artifact* matches it. Those are different claims and must not be
  conflated.
- **What this does NOT fix:** the harness has not actually been published at a version
  that includes this session's work. That is a real, visible, external, hard-to-reverse
  action (`npm publish` is effectively permanent — versions cannot be unpublished after
  72 hours, and even within that window it's disruptive to anyone who installed) and is
  therefore the human's call, not something to do proactively. Until an operator runs
  `pnpm release`, "ready to integrate via `npx`" is not yet true; "ready to integrate
  via git clone + build from source" is true today and verified (`ideal-harness doctor`
  passes against this checkout).
- **Alternatives rejected:** silently leaving the README's npm instructions as-is
  because "the source is what matters" — rejected; a reader follows the instructions on
  the page, not the ADR, and stale instructions that 404 or silently run old code are
  actively worse than no instructions.
- **Home:** `README.md` (Tier 2 section).

## D023 — `scripts/setup.mjs` didn't wire the `web` MCP server into new projects
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** Added `'web'` to `setup.mjs`'s hardcoded module list (was `['guard',
  'compress', 'memory', 'orchestrate']`) and parameterized the "approve N servers"
  message off that list's length instead of a hardcoded `4`.
- **Why:** Found while auditing "develop from source" — the one install path D022
  confirmed actually works today — for completeness. `pnpm setup` is the documented
  fallback for anyone who can't yet use the (stale) published npm package; it silently
  dropping a whole module for every *new* project it wires up would have made "clone and
  build" not actually deliver everything either, undermining the one integration path
  that was supposed to be trustworthy. Verified by running it against a scratch
  directory and inspecting the resulting `.mcp.json`.
- **Alternatives rejected:** none considered — this was an omission (the module list
  predates `web`'s existence), not a scoped-down design choice.
- **Home:** `scripts/setup.mjs`.

## D024 — `policy_check` (the Tier-2 embedding entry point) ignored operator config and floor mode entirely
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** `policy_check` now calls `resolveOperatorTiers()` (leases + user + team
  + defaults, same as the interactive hook) and `applyFloorMode(decision, floorMode())`
  before returning — previously it called the bare single-tier `evaluate(request,
  DEFAULT_RULES)` with no floor-mode application at all.
- **Why:** This is the exact tool `README.md`'s "Integrating into a product or
  pipeline" section tells a Tier-2 embedder to call to "gate your own tool calls the
  same way the hook does." It wasn't doing that — it evaluated against a hardcoded
  default floor, deaf to any lease, user policy, or team policy rule, and never applied
  `soft`/`enforce`/`bypass` at all, so its answer could actively disagree with what the
  *actual* interactive hook would decide for the identical input on the identical
  machine. This is the same class of bug as D019, found by the same method (don't trust
  that "gated" means "gated against the real configuration" — check what it's actually
  evaluating against), but in the single most central integration tool rather than two
  secondary ones. It had **zero test coverage**, which is how it went unnoticed;
  `test/guard/mcp.test.ts` (new) now covers tier-awareness and both non-default floor
  modes.
- **Alternatives rejected:** leaving `policy_check` as a "defaults-only, advisory"
  oracle and documenting that caveat instead of fixing it — rejected because the whole
  point of a Tier-2 embed is that the embedder's product is running with a real,
  operator-configured policy; an oracle that can't see that configuration isn't
  answering the question an embedder actually has.
- **Home:** `src/guard/runtime/mcp.ts`, `test/guard/mcp.test.ts` (new, 9 tests — the
  guard MCP server had none before this).

## D025 — `.claude-plugin/plugin.json` is missing the `web` MCP server; not fixed here, by design
- **Date:** 2026-08-11
- **Status:** resolved (2026-08-11, same day) — the human explicitly authorized this
  exact edit in response to this entry ("fix all the remaining things," after being
  shown the precise JSON to add), which is the human-in-the-loop this entry's original
  reasoning required. Both `plugin.json` (added `ideal-harness-web` to `mcpServers`,
  updated the description) and `marketplace.json` (updated the plugin description to
  mention `web`) are fixed; `ideal-harness doctor` reconfirmed all 5 servers register
  and boot. The original reasoning below is kept for the record.
- **Decision:** Found, but deliberately NOT fixed by this session: the distributed
  plugin manifest (`.claude-plugin/plugin.json`) declares 4 `mcpServers` (guard,
  compress, memory, orchestrate) and is missing `ideal-harness-web`. `.claude-plugin/
  marketplace.json`'s single plugin description also doesn't mention `web`. Both files
  match the self-policy deny pattern (`\.claude-plugin/`, `src/guard/policy/
  defaults.ts`) and `CLAUDE.md`'s own explicit "Never touch" instruction.
- **Why not fixed here:** `CLAUDE.md` states plainly: "Never touch:
  `.claude/settings.json`, `.claude-plugin/*`, `src/guard/policy/*` are
  policy-protected — the floor denies edits to them," and separately: "If one of them
  genuinely needs to change... say so explicitly and let the human make the edit." This
  is exactly that case. The floor would only *ask* (soft mode, the default here) rather
  than hard-block — but the instruction is a directive to the agent, not merely a
  description of the technical gate, and this session honors it as written rather than
  routing around it by triggering the ask and hoping it's approved without discussion.
- **What a human needs to add** to `.claude-plugin/plugin.json`'s `mcpServers` object:
  `"ideal-harness-web": { "command": "node", "args":
  ["${CLAUDE_PLUGIN_ROOT}/dist/web/cli/index.js", "mcp"] }` — the exact same shape as
  the four existing entries, confirmed against `scripts/setup.mjs`'s (now-fixed, D023)
  equivalent wiring for the from-source path.
- **Alternatives rejected:** attempting the edit and letting the ask-prompt surface for
  approval — rejected as not actually different from "asking a human to approve editing
  the floor's own protected surface on the agent's initiative," which is the specific
  shape of action `CLAUDE.md`'s instruction exists to prevent, softness of the floor
  notwithstanding.
- **Home:** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.

## D026 — `web_fetch` had no SSRF guard; added one, honestly scoped
- **Date:** 2026-08-11
- **Status:** active
- **Decision:** New `src/web/ssrf.ts`: rejects `localhost`/`*.localhost`, rejects a
  literal private/loopback/link-local/reserved IPv4 or IPv6 address (including the
  IPv4-mapped-IPv6 form and the cloud-metadata range `169.254.0.0/16`), and — for a
  hostname — resolves it via DNS and rejects if **any** resolved address is
  private/reserved. `fetch.ts` switched from `redirect: 'follow'` to a hand-rolled
  redirect loop that re-runs the same check on every hop, so a redirect can't bypass it.
- **Why:** Found during a capability audit against `DESIGN.md`'s original source list —
  firecrawl's SSRF guard was explicitly named as security-sensitive in `DESIGN.md §10`
  (R2), and the risk log's own warning ("classically miss DNS-rebinding / redirect-
  following / IPv6+decimal-IP bypasses") turned out to describe exactly what was
  missing: `web_fetch` accepted any URL an operator's policy allowed, with no check
  against internal/private targets at all. Since `web_fetch` is model-invokable and its
  URL argument is exactly the kind of thing a prompt injection could try to steer, this
  is a real pivot from "read a web page" to "reach the internal network" (cloud
  metadata endpoints, internal admin panels) — worth closing, not just noting.
- **What this does NOT close, stated as plainly as the drift-guard grep-tier limitation
  is stated elsewhere in this file:** DNS rebinding. There is a real time-of-check-to-
  time-of-use gap between this module's own DNS lookup and the TCP connect `fetch()`
  performs internally — an attacker who also controls DNS for the target hostname could
  serve a public IP for the check and a private one moments later. Closing that
  fully requires pinning the checked IP into the actual connection (a custom low-level
  dispatcher), which was not built, to keep `web` dependency-free and auditable. Decimal/
  octal/hex IP-literal bypasses ARE closed, for free — the WHATWG URL parser (`new
  URL()`) normalizes those into dotted-quad form before this module ever sees the
  hostname, verified by a test that checks `new URL('http://2130706433/').hostname ===
  '127.0.0.1'`.
- **Alternatives rejected:** a full custom-dispatcher IP-pinning solution to also close
  DNS rebinding — rejected for now as more complexity/dependency surface than this
  fetch-only, already-narrowly-scoped module (`decisions.md` D012) warrants; the
  residual risk is stated, not hidden, which is the honest middle ground this project
  already takes elsewhere (drift-guard's grep tier, the same pattern).
- **Home:** `src/web/ssrf.ts` (new), `src/web/fetch.ts`, `test/web/ssrf.test.ts` (new,
  11 tests), `test/web/fetch.test.ts` (+2 tests).

## D027 — Confirmed, honestly-scoped gaps found during a full source-capability audit
- **Date:** 2026-08-11
- **Status:** active (informational — records confirmed gaps, not a design choice)
- **Decision:** Verified every "take" from `DESIGN.md §3`'s adjudication tables against
  the actual shipped code (grep/read, not memory) rather than trusting the tables were
  still accurate. Two real, previously-un-flagged-as-checked gaps confirmed absent:
  - **`autoplan`** (gstack's dual-model consensus gauntlet for planning/review,
    `DESIGN.md §5` L5) — never shipped, in v0.1 or since. `IMPLEMENTATION.md` already
    said so honestly for v0.1; this confirms it's still true after `v2 Phase 1`/`Phase
    2`. Not a quick fix — it requires calling a second model as an independent voice,
    a genuinely different kind of capability than anything built this session, and
    deserves its own scoped plan rather than a bolt-on.
  - **OSV/semgrep shell-out** for `vet_skill` (`IMPLEMENTATION.md`'s own M2 spec: "64-
    pattern signature DB + homoglyph check + shell-out to OSV for deps + shell-out to
    semgrep if present") — only the signature DB + homoglyph half shipped
    (`src/guard/vet/patterns.ts`); the OSV/semgrep shell-outs were never added. Lower
    urgency than D026 (this is a coverage gap on already-narrow skill vetting, not an
    open network-reachability issue) but a real, confirmed absence.
  Everything else audited (curator, caveman, doctor/health-check pattern, tree-sitter
  code-graph, injection wrapping, loop guard, spend governor, retry/backoff, drift-guard
  ladder, skill templating + multi-host gen, references/ progressive disclosure, the
  full v2-addendum list: task-observer→session-observer, i-have-adhd→focus, find-skills
  pattern→deferred to v0.5, Scrapling idea→fetch.ts's 3-strategy fallback,
  mattpocock→grill-with-docs+tdd, hallmark→design-critique, claude-code-setup→doctor,
  obsidian→bridge, astryx→correctly unclaimed) confirmed present and matching its
  documented scope.
- **Why recorded here:** honesty requires checking, not just having once written down,
  that a claimed capability exists — the same discipline D019/D022/D024 already applied
  to integration paths, now applied to the original source-adjudication claims
  themselves.
- **Home:** this file; `DESIGN.md §3` (the tables being audited).
- **Status update (2026-08-11, same day):** both gaps closed — see D028 (autoplan) and
  D029 (OSV/semgrep shell-out) below.

## D028 — autoplan: cross-model-tier plan-critic, not a second vendor/API
- **Date:** 2026-08-11
- **Status:** decided, shipped
- **Decision:** Closed D027's `autoplan` gap with `agents/plan-critic.md`, a new
  Claude-Code-native subagent pinned to a different model tier (`model: opus` in its own
  frontmatter) from whatever the authoring/planning conversation runs on. Wired into
  `skills/subagent-driven-development/SKILL.md` as an optional step between "plan → ledger"
  and "dispatch implementer": for non-trivial plans (same ≥3-task bar the skill's own
  "When NOT to use" section already draws), the controller spawns `plan-critic` with the
  plan/ledger tasks before any implementer runs. It never edits — read-only tools (`Read,
  Grep, Glob`) — and returns the same `PASS` / severity-tagged-issue contract `reviewer`
  already uses, so a blocker sends the plan back for revision.
- **Why this shape, not a literal second model vendor:** gstack's original "dual-model
  consensus gauntlet" implies two different model *vendors* or a dedicated critique API.
  Building that would mean a new runtime dependency (`@anthropic-ai/sdk` or similar), an
  API key the harness would have to manage, and a per-call cost the harness would have to
  govern — this project ships **zero runtime dependencies** today (`package.json` has none;
  even `web-tree-sitter` is a devDependency, bundled as WASM), and that's a deliberate
  property, not an oversight. Claude Code's own `Agent` tool already exposes a `model`
  parameter (`sonnet|opus|haiku|fable`) and subagent frontmatter already supports pinning
  one — the same native mechanism `scout`/`implementer`/`reviewer` are built on. Using a
  *different* model tier to critique a plan is genuinely a different reasoning trace (not
  the same weights re-reading their own output in the same context), which is the actual
  value gstack's design was chasing — achieved here with one new markdown agent file, zero
  new dependencies, zero API keys, and no cost mechanism beyond what the user's Claude Code
  plan already covers.
- **What this is NOT, stated plainly so nobody downstream overclaims it:** this is not
  calling a separate AI vendor (OpenAI, Gemini, etc.) for a truly independent second
  opinion outside Anthropic's own model family. If that stronger form of independence is
  ever wanted, it is a distinct, larger scope decision (new dependency, API key management,
  spend governance) — not a natural next step of this change.
- **Alternatives rejected:** (1) a real second-vendor API call — rejected as a runtime
  dependency + cost + key-management burden disproportionate to what was asked ("use the
  remaining ones... without going off the limits"); (2) same-model self-critique in the
  same context — rejected because it doesn't produce an independent reasoning trace, just a
  second pass over the same rationalizations; (3) a new orchestrate-module *code* path —
  rejected because the existing agent-definition mechanism already solves this with zero
  new code, matching how `scout`/`implementer`/`reviewer` are built.
- **Home:** `agents/plan-critic.md` (new), `.claude/agents/plan-critic.md` (new git
  symlink, mode 120000, matching the other three agent pointers),
  `skills/subagent-driven-development/SKILL.md` (loop step 2, renumbered),
  `skills/using-ideal-harness/SKILL.md` (orchestrate routing row).

## D029 — OSV/semgrep shell-out for skill vetting, policy-gated and presence-detected
- **Date:** 2026-08-11
- **Status:** decided, shipped
- **Decision:** Closed D027's OSV/semgrep gap. New `src/guard/vet/external.ts`:
  `runSemgrep(dir)` shells out to `semgrep` against a **bundled, offline ruleset** (written
  to a temp file per call, never the hosted Semgrep registry — no network call at all) and
  `runOsvScanner(dir)` shells out to `osv-scanner` (which DOES reach osv.dev over the
  network, whenever a lockfile is present). New `scanSkillDir(dir)` merges these with the
  existing regex+hidden-char scan run over every file in the directory. Both external tools
  are presence-detected (`<bin> --version`) and absence degrades to `available:false,
  ran:false` — same honesty pattern as drift-guard's tree-sitter/grep tier fallback, never
  a hard failure of the vet. New MCP tool `vet_skill_deep` (directory-based, alongside the
  existing text-only `vet_skill`) and CLI `ideal-harness-guard vet --deep <dir>`.
- **Gated like `runVerify`, not left open:** both actual scan invocations (not the
  `--version` presence probe) are evaluated as a synthetic `Bash` request through
  `evaluateTiered` against the caller's policy tiers, with **no floor-mode softening** —
  only an explicit `allow` runs. This mirrors `orchestrate/verify.ts`'s `runVerify` exactly
  (there is no human present to answer an `ask` in this unattended path) and matters most
  for `osv-scanner`'s network egress — the same class of exposure D026's SSRF guard closes
  for `web_fetch`, now closed here too instead of left as a second silent hole.
  `execCommand`/`ExecResult`/the Windows-safe process-tree-kill logic were moved out of
  `orchestrate/verify.ts` into a new `src/guard/exec.ts` (guard is the lower layer;
  orchestrate already imports from guard, so the reverse import would have been circular)
  so both call sites share one tested implementation instead of two.
- **Honesty note — what's actually tested:** neither `semgrep` nor `osv-scanner` is
  installed in this repo's own dev environment, so only the "absence" path (`available:
  false`) is exercised against the real binaries. The parsing/merging/gating logic is
  fully covered via an injectable `execFn` (`test/guard/vet-external.test.ts`, 9 tests)
  standing in for a present tool — the same dependency-injection pattern D026's
  `DnsLookupFn` already established for offline-testable external I/O. Stated plainly
  rather than claimed as end-to-end verified against the real tools.
- **Semgrep ruleset scope:** a small, clean-room set of 6 AST rules (JS/TS `eval`,
  `child_process.exec`; Python `eval`/`exec`, `subprocess(shell=True)`/`os.system`,
  `pickle.loads`, `yaml.load` without `SafeLoader`) — the class of finding an AST can
  reach and a regex can't (distinguishing a real call from a comment that merely mentions
  the same words). Not a port of semgrep's own registry; deliberately small and reviewed
  by hand since neither this environment nor CI can execute semgrep to catch a rule-syntax
  mistake before a user's box with semgrep installed would.
- **Home:** `src/guard/vet/external.ts` (new), `src/guard/exec.ts` (new, moved from
  `orchestrate/verify.ts`), `src/guard/vet/scan.ts` (`ScanFinding.category` widened,
  `SEVERITY_ORDER` exported), `src/guard/runtime/mcp.ts` (`vet_skill_deep`),
  `src/guard/cli/index.ts` (`vet --deep`), `test/guard/vet-external.test.ts` (new, 9
  tests).

## D030 — Full re-audit (embedding host: GroundWatch) — journal rotation, doc/code drift, Java/Kotlin structural memory
- **Date:** 2026-08-13
- **Status:** decided, shipped
- **Decision:** Run from the embedding host's own working session, not this repo's — a
  full diligence pass requested to find and close real gaps, not just re-confirm known
  ones. Ran the actual test/build/lint/validate pipeline first (all green, 329/329, before
  any change), then fixed four confirmed issues:
  1. **Guard journal had no rotation** — `.ideal-harness/guard-journal.jsonl` grows one
     line per tool call, forever, with no cap anywhere in `journal.ts`. Added
     `JOURNAL_MAX_ENTRIES` (default 5000, `IDEAL_HARNESS_JOURNAL_MAX_ENTRIES` override, `0`
     disables) — the active file is renamed to `guard-journal.N.jsonl` before the next
     append once it hits the threshold, never truncated or deleted. Each archive keeps its
     own hash chain fully verifiable on its own; the fresh active file starts a new chain
     from genesis, reusing the exact fallback `readLastHash` already had for a missing
     file — zero new edge case invented, just an existing one reused deliberately. 4 new
     tests (`test/guard/journal.test.ts`).
  2. **README documented 5 of 9 skills and 0 of 4 agents** — a first-time reader had no
     single place to learn `focus`/`grill-with-docs`/`session-observer`/`tdd` or any of
     `scout`/`plan-critic`/`implementer`/`reviewer` exist. Added a "Skills & agents" section
     (two tables, one line per skill/agent, sourced from each file's own frontmatter
     `description` — not paraphrased from memory) between "Tools the agent or host invokes"
     and the statusline section.
  3. **`IMPLEMENTATION.md` claimed a `<ideal-harness-qid:>` marker that was never built** —
     grepped `src/` and `hooks/` for it; zero matches. What actually shipped is
     `hooks/pretooluse.mjs` emitting Claude Code's native `permissionDecision: 'ask'`
     contract directly (rule id + operator knobs folded into `permissionDecisionReason`).
     The capability (deterministic HITL ask-gate) is real and tested; only the specific
     wire-format description in the doc was stale. Corrected in place rather than deleted,
     so the historical intent stays legible.
  4. **Structural memory's tree-sitter tier had no Java or Kotlin grammar** — `Lang` was
     `typescript | tsx | javascript | python` only. The embedding host (GroundWatch) is
     majority Java (ten Spring Boot services) plus a Kotlin mobile app; both silently fell
     back to the regex tier, honestly but coarsely. Added `tree-sitter-java` (ships a
     prebuilt `tree-sitter-java.wasm`, no build step) and
     `@tree-sitter-grammars/tree-sitter-kotlin` (same — prebuilt `.wasm`) as
     devDependencies, extended `GRAMMAR_PACKAGE`/`GRAMMAR_WASM`/`languageForFile`
     (`.java`, `.kt`, `.kts`), and added `JAVA_DEF_TYPES` (class/interface/enum/record/
     annotation-type/method/constructor) and `KOTLIN_DEF_TYPES` (class/object/function —
     Kotlin's grammar cannot distinguish interface-from-class or method-from-function at
     the node-type level, reported as the coarser kind rather than guessed). Import-edge
     extraction was deliberately left unbuilt for both languages: Java's
     `import_declaration` and Kotlin's import node carry the path as untyped child tokens,
     not a single named field the way JS/Python's import statements do, and reconstructing
     a dotted path by concatenating them would be exactly the kind of guess this tier
     exists to avoid — an empty edge list is honest, a wrong one would not be. Verified two
     ways: 2 new unit tests (`test/memory/treesitter.test.ts`), and live against real
     GroundWatch source through the actual running `memory` MCP server (not just the test
     harness) — `add_file` on a real `.java` service file and a real `.kt` mobile file both
     returned `tier: "treesitter"` with correct symbols, and `query_graph` retrieved both
     files' symbols together for a single cross-language natural-language query.
- **Why now, not deferred like the Design & Taste module (D031)**: all four are genuine
  bugs or gaps with a bounded, mechanical fix — a missing cap, a doc/code mismatch, two
  missing grammar packages with prebuilt WASM already on the registry. None required
  inventing a new rule catalog or enforcement surface, which is the line this project
  already draws (see D031).
- **What this does NOT do:** it does not backfill structural memory for every previously-
  indexed file — re-indexing existing entries at the new tier is a `add_file`/rebuild
  concern for whoever operates the graph, not something this change silently triggers.
- **Alternatives rejected (journal rotation):** a hard entry-count truncation (delete
  oldest lines in place) — rejected because it destroys audit history the journal exists
  to preserve, the opposite of "nothing invisible"; a time-based rotation (daily file) —
  rejected as needing a clock dependency this module deliberately stays pure of (see the
  file's own header comment on `ts` being caller-supplied).
- **Alternatives rejected (Java/Kotlin import edges):** best-effort string-concatenation
  of untyped children — rejected per the honesty-by-construction principle `drift.ts`
  already established; a wrong edge is worse than no edge because nothing downstream
  knows to distrust it.
- **Home:** `src/guard/journal.ts`, `test/guard/journal.test.ts`, `README.md` ("Skills &
  agents"), `IMPLEMENTATION.md`, `src/memory/structural/treesitter.ts`,
  `test/memory/treesitter.test.ts`, `package.json` (2 new devDependencies).

## D031 — Confirmed still-open gaps: Design & Taste module, gstack's `/browse` daemon — not built, on purpose, not silently
- **Date:** 2026-08-13
- **Status:** active (informational — records confirmed gaps found during D030's audit, deliberately not closed in the same pass)
- **Decision:** Two capabilities remain designed-on-paper, never coded, confirmed again
  during D030's audit rather than just re-read from an old note:
  1. **Design & Taste (`pbakaus/impeccable` + `emilkowal.ski/skill`)** — `DESIGN.md` rates
     `impeccable` a **take-whole, spine-level** source ("the only design tool with
     enforcement below the LLM"), same tier as `headroom`. There is no `detect.mjs`, no
     design-linting hook, anywhere in `hooks/` or `src/`. `skills/design-critique/SKILL.md`
     covers part of the *intent* (a pre-emit self-critique pass) but is model-cooperative —
     a prompt the model can choose to follow — not deterministic code below the model the
     way `impeccable` was specifically prized for.
  2. **gstack's `/browse` warm-Chromium daemon** — `DESIGN.md` §R3 already states this
     honestly: "the single biggest build (gstack's is ~24K LOC)," deferred to v0.2, still
     not started. `web` remains fetch-only per D012.
- **Why not built in this pass, unlike D030's four fixes:** both are net-new enforcement
  surfaces, not bugs. A real design-taste linter needs an actual rule catalog decided by a
  human (which hex values are banned, what counts as "slop," what the reflex-reject list
  contains) — that is a judgment exercise, not a mechanical fix, and shipping a rushed
  placeholder rule set into a security-adjacent hook path would be worse than the honest
  gap that exists today. A warm-Chromium daemon is a ~24K-LOC subsystem (process
  lifecycle, CDP protocol, idle shutdown, injection classifier) that no single session
  should attempt speculatively.
- **What a real next step looks like, if greenlit:** Design & Taste — start narrow: one
  deterministic rule (e.g. flag hex colors in `.tsx`/`.css` edits that don't match an
  existing token file), wired to `PostToolUse` as an `ask` (not a hard block, matching the
  soft-by-default floor), before adding a second rule. `/browse` — depend on
  `chrome-devtools-mcp` as an external MCP first (the option `DESIGN.md` itself already
  names), reimplement the daemon only if that proves insufficient.
- **Alternatives rejected:** shipping either as a minimal/fake version to close the gap
  cosmetically — rejected as the opposite of this project's honesty rule; a claimed
  capability that doesn't hold up is worse than a stated absence.
- **Home:** this file; `DESIGN.md §3`, §R3 (the sources/estimates being re-confirmed).
- **Status update (2026-08-13, same day):** the narrow first rule proposed above was
  greenlit and shipped — see D032. `/browse` remains open.

## D032 — Design & Taste v1: one deterministic rule (hex-color-vs-token-file), not the full module
- **Date:** 2026-08-13
- **Status:** decided, shipped
- **Decision:** New `src/guard/design.ts`: `checkDesignTokens(filePath, content)` flags a
  hex color literal in a `.tsx`/`.jsx`/`.css`/`.scss`/`.less` file that isn't already
  present in the project's own design-token file. Off by default —
  `IDEAL_HARNESS_DESIGN_TOKENS_FILE` (a path to the token source) opts a project in;
  unset means "not configured," a silent no-op, never a guess at what counts as a
  violation with nothing to compare against. A missing/unreadable token file fails open
  the same way. Wired into `hooks/posttooluse.mjs` as an `additionalContext` warning —
  the same advisory channel the existing secret-redaction/injection warnings already use,
  since PostToolUse has no permission-decision contract to gate with (the action already
  happened by the time this hook runs); a finding here is a flag the model reads, not a
  block. 10 new tests (`test/guard/design.test.ts`), plus live verification against
  GroundWatch's real `apps/web-console/src/styles/variables.css`: a fabricated `#FF00FF`
  was correctly flagged, the project's real brand teal `#14736B` was correctly recognized
  as approved.
- **Why this rule first, and why deterministic set-membership, not anything fuzzier:**
  it's mechanical (no taste judgment to encode), it's the exact shape `impeccable`'s own
  `detect.mjs` was praised for (a plain pattern check, not an LLM opinion), and a design
  system almost always already has a token file to check against — no new authoring
  burden on the operator.
- **What this is NOT, stated plainly:** not the reflex-reject catalog, not the two-altitude
  slop test, not per-model defect blocks, not `emilkowal.ski`'s animation-review framing —
  those all still require a human-decided rule set this pass didn't invent one for. This
  is one rule, not the module DESIGN.md originally scoped.
- **Alternatives rejected:** hardcoding a "banned colors" list into the harness itself —
  rejected because taste is project-specific (GroundWatch's teal is another project's
  clash), and a harness-wide opinion about color would be exactly the guess D031 already
  rejected; blocking via PreToolUse instead of an advisory — rejected because the file has
  already been written by the time any check could run PostToolUse, and retrofitting a
  pre-write content scan into PreToolUse's `Edit`/`Write` path is a larger, riskier change
  than one narrow rule warrants on its first pass.
- **Home:** `src/guard/design.ts` (new), `src/guard/index.ts` (exports),
  `hooks/posttooluse.mjs` (`designLintWarning`), `test/guard/design.test.ts` (new, 10
  tests).
- **Status update (2026-08-13, same day):** the human-supplied name list was re-checked
  against two named design-reference sites and produced real, adoptable content — see
  D033.

## D033 — Motion design sourced for real: `motion-design` skill + a second deterministic rule
- **Date:** 2026-08-13
- **Status:** decided, shipped
- **Decision:** Two names from the operator's source list needed grounding rather than
  guessing: "Motion.dev" (confirmed: `motion.dev`, the JS/React/Vue animation library
  formerly Framer Motion) and a garbled term now confirmed to mean **taste-skill**
  (`Leonxlnx/taste-skill` — already correctly identified in `DESIGN.md`'s own table, just
  not connected to the garbled name in D031's audit). Researching Motion.dev's own
  ecosystem surfaced a third, more directly useful source not previously in this ledger:
  `kylezantos/design-motion-principles` (MIT, 900+ stars) — a real, complete, two-mode
  (Create/Audit) Claude skill distilling the *publicly published* work of three named
  designers (Emil Kowalski, Jakub Krehel, Jhey Tompkins) into a context-weighted framework:
  a frequency gate, context-dependent duration guidelines, a "best animation is unnoticed"
  golden rule, and a mandatory `prefers-reduced-motion` rule with no exceptions. This is
  substantially richer than `DESIGN.md`'s original one-line note on `emilkowal.ski/skill`
  ("animation-review framing... thin course funnel") — the richer source superseded the
  thin one for this build, both stay cited.
  1. **New `skills/motion-design/SKILL.md`** — adapted from `design-motion-principles`
     (MIT; the three-lens framing is stated, as the source itself states it, as "named in
     tribute... not authored or endorsed by the designers themselves"). Deliberately
     condensed to one file matching this harness's own skill convention (the source's
     multi-file `references/` tree is compressed to what a single-file skill needs, not
     imported wholesale) — mode detection, the three-lens table + context-to-perspective
     mapping, the frequency gate, duration guidelines, the golden rule, motion-specific
     slop patterns, and the mandatory accessibility rule. Cross-linked from
     `design-critique` (one line, not a merge — motion is a large enough topic to warrant
     its own file, same reasoning that already separates `focus` from `caveman`).
  2. **New deterministic rule, `checkReducedMotion`** — flags a new CSS
     animation/transition introduced without a `prefers-reduced-motion` accommodation in
     the same edit. Unlike `checkDesignTokens` (D032), this needs no operator-configured
     reference file to be meaningful, so it's **on by default** (kill switch
     `IDEAL_HARNESS_DESIGN_LINT=off`) — but its warning text says "verify," not
     "violation," because it can only see the current edit, not a global stylesheet that
     might already handle this elsewhere in the project. Verified live against
     GroundWatch's real `apps/web-console/src/styles/global.css` (which already handles
     `prefers-reduced-motion` once, correctly) and a synthetic isolated `@keyframes` edit
     (correctly flagged). 7 new tests.
- **`taste-skill`'s actual content, now on record** (was under-described in D031/DESIGN.md):
  three 1-10 dials — `DESIGN_VARIANCE` (layout experimentation), `MOTION_INTENSITY`
  (animation depth), `VISUAL_DENSITY` (information per viewport) — plus brief-inference to
  design-system routing and a banned-hex-list anti-slop mechanism. That last piece is
  independently the same shape as D032's `checkDesignTokens` — convergent validation that
  the hex-vs-token check was the right first deterministic rule to ship, not a coincidence
  of choosing it in isolation.
- **What was explicitly NOT adopted, and why:** Motion.dev's own "AI Kit" (`npx motion-ai`,
  an MCP + `/motion` skill for saved-transition retrieval, bundled with the paid Motion+
  tier, ~£299/yr) — not bundled into this harness for the same reason `claude-in-chrome`
  was skipped in the original `DESIGN.md` table: closed/paid/account-gated, not something
  this harness's zero-runtime-dependency, offline-capable posture can depend on. An
  operator who already has Motion+ can still use it alongside the harness; the harness
  itself doesn't assume or require it.
- **Still unresolved:** the second named site ("populateui" / "populate UI") does not
  resolve to any identifiable design tool, component library, or resource under that name
  or close variants — two separate web searches came back empty. Recorded here rather than
  silently dropped; needs a URL or a corrected name from the operator before it can be
  checked against anything.
- **Alternatives rejected:** merging `motion-design` into `design-critique` — rejected as
  making an already-focused skill sprawl, the same reasoning `focus`/`caveman` already
  established for related-but-distinct output concerns; making `checkReducedMotion`
  opt-in like the token check — rejected because, unlike token-vs-hex (which needs a
  reference file to mean anything), a reduced-motion check is self-contained and
  accessibility is the one place this module's own source material states "not optional,
  no exceptions" rather than "context-dependent."
- **Home:** `skills/motion-design/SKILL.md` (new), `skills/design-critique/SKILL.md`
  (cross-link), `src/guard/design.ts` (`lintReducedMotion`, `checkReducedMotion`),
  `src/guard/index.ts` (exports), `hooks/posttooluse.mjs` (`designLintWarnings`, plural),
  `test/guard/design.test.ts` (+7 tests, 17 total in the file).

## D034 — `/browse` built: real daemon + CDP client + 6 gated MCP tools, honestly scoped down from gstack's ~24K LOC
- **Date:** 2026-08-13
- **Status:** decided, shipped
- **Decision:** D031 confirmed gstack's `/browse` warm-Chromium daemon as the largest
  remaining honest gap — "no single session should attempt speculatively." Explicit
  operator direction ("complete the browse functionality... completely build it") changed
  that call for this pass, with the scope reduction D031 already named as the sane path:
  depend on the operator's own Chrome (found, never downloaded/bundled) rather than
  hand-rolling gstack's full ~24K-LOC subsystem (ONNX/Haiku injection classifier,
  multi-tab/session management, drag-and-drop all explicitly out of scope, stated plainly,
  not silently dropped).
  1. **`src/web/browse/daemon.ts` + `watchdog.ts`** — atomic state (write-then-rename,
     same contract `journal.ts` already established), `findChromeExecutable`
     (`CHROME_PATH`/`PUPPETEER_EXECUTABLE_PATH` override, well-known per-platform paths,
     `existsSync`-checked, never throws), and **real, not lazy-only, idle shutdown**: a
     small companion watchdog process (Chrome's actual OS parent) polls the shared state
     file and kills Chrome + itself once idle, with nothing needing to call back in to
     trigger it — the same gap a call-triggered-only reap would have left open forever if
     nothing ever called `browse` again.
  2. **`src/web/browse/cdp.ts`** — a minimal CDP client (request/response only, no generic
     event bus — `actions.ts` polls `document.readyState` for "did navigation finish"
     instead) over `ws`, an **optional devDependency** — the exact same "optional engine
     tier, degrades to a clear error when absent" contract `web-tree-sitter` already
     established for `memory`. Not Node's native `WebSocket`: that only stabilized in
     Node 22, and this package's `engines` field is `>=20` — a silent break for Node
     20/21 users would be worse than one well-established, zero-dependencies-of-its-own
     package.
  3. **`src/web/browse/actions.ts`** — `navigate`/`snapshot`/`click`/`typeText`/
     `screenshot`/`evaluate`. `snapshot` walks the live DOM via `Runtime.evaluate` and
     tags interactive elements with `data-ih-uid`, rather than rendering the full CDP
     `Accessibility` domain's AX-tree graph `chrome-devtools-mcp` itself builds — simpler,
     reliably testable, same practical result. `click`/`typeText` dispatch through the
     same injected script (real `.click()`, a native-setter `.value` assignment +
     `input`/`change` events) rather than synthesized `Input.dispatchMouseEvent` — works
     for ordinary web content, stated as not fooling a listener that specifically
     requires an OS-level event.
  4. **6 new MCP tools** (`browse_navigate/snapshot/click/type/screenshot/evaluate`, plus
     `browse_close`) in `web/runtime/mcp.ts`, gated through a new `gateBrowse` (`gate.ts`)
     — the literal `WebFetch` policy rule, same as `web_fetch`/`web_docs`, per D018/D019's
     "any MCP tool doing its own I/O must gate itself like the native tool would." An
     operator who has denied/asked WebFetch has denied/asked every browse action too, not
     just the one literally named `web_fetch`.
- **Two real bugs found and fixed during this build, not shipped silently past them:**
  - `/json/version`'s `webSocketDebuggerUrl` is the browser-level CDP target — confirmed
    live that `Page.enable` fails against it ("wasn't found"). Fixed by having the
    watchdog create one page target via `/json/new` at startup and use *that* target's
    `webSocketDebuggerUrl` for the whole warm session, not a fresh tab per call.
  - The watchdog's `writeStateAtomic` never created `.ideal-harness/` before writing,
    throwing `ENOENT` in any cwd that hadn't used the harness's state folder yet —
    invisible in manual testing (this repo's own `.ideal-harness/` already exists) and
    only surfaced once the integration tests ran from fresh temp directories. Found by
    actually running the test suite, not just the manual smoke test.
- **Honesty check — what "complete" means here, stated plainly:** verified two ways, not
  claimed on the strength of unit tests alone. 3 new integration tests run for real
  against whatever Chrome `findChromeExecutable` finds (skip, not fail, when none is
  present — matching the `semgrep`/`osv-scanner` presence-detected contract): a full
  session (spawn → navigate to a real page → snapshot → screenshot → evaluate → click →
  shutdown), daemon reuse across two `ensureDaemon` calls, and genuine idle self-
  termination with nothing calling back in. All three passed live, repeatedly, on this
  machine's real Chrome install — not mocked. 368 tests total (was 345), full
  check/build/biome/validate clean.
- **What this explicitly does NOT claim:** feature parity with `chrome-devtools-mcp` or
  gstack's own daemon (no AX-tree domain, no multi-tab, no drag-and-drop, no injection
  classifier). A CDP session this simple could theoretically be fooled by a page that
  specifically detects non-native input events — not a concern this pass tried to close.
- **Alternatives rejected:** bundling Puppeteer/Playwright (a real Chromium download +
  hard runtime dependency) — rejected, same VISION §6.2 zero-runtime-deps reasoning
  `fetch.ts` already states, and unnecessary once the operator's own Chrome is
  discoverable; hand-rolling the WebSocket protocol frame-by-frame to stay at literally
  zero devDependencies — rejected as a large amount of fragile, security-sensitive
  protocol code for zero benefit over one audited, ubiquitous library; depending on
  `chrome-devtools-mcp` as an external MCP (`DESIGN.md`'s own originally-named first
  step) — not taken this pass because the direct ask was to build the daemon pattern
  itself, not wire an external server; still a reasonable alternative for an operator who
  wants the fuller AX-tree feature set instead.
- **Home:** `src/web/browse/{daemon,watchdog,cdp,actions,index}.ts` (new),
  `src/web/gate.ts` (`gateBrowse`), `src/web/index.ts` (re-exports, module doc),
  `src/web/fetch.ts` (module doc corrected — no longer implies browse is unbuilt),
  `src/web/runtime/mcp.ts` (6 new tools + `withBrowseSession`), `src/guard/exec.ts`
  (`killProcessTree` extracted as a pid-based primitive, `killTree` now delegates to it),
  `src/guard/index.ts` (export), `package.json` (+`ws`, `@types/ws` devDependencies),
  `test/web/browse/{daemon,integration}.test.ts` (new, 13 tests), `test/web/mcp.test.ts`
  (+2 tests).

## D035 — Egress domain allowlist: WebFetch joins the learning/ratification loop, scoped to origin

`VISION.md` §3.3 listed this under `guard`'s "could become": *"Egress domain allowlist.
First-use prompt per domain, remembered thereafter — Anthropic-checklist alignment,
straightforward with the existing tier machinery."* It was correct that the machinery
already existed — `learn.ts`'s `proposeAllowRules`/`ratifyShape` — but that machinery was
hardcoded to `Bash` only (`test/guard/learn.test.ts` had an explicit test asserting
non-Bash tools are never learned from). WebFetch asks were visible in `summarizeAsks`'
digest but had no path from "asked repeatedly" to "remembered" — every fetch required
approval forever, with no ratification route, unlike every Bash command shape.

**What shipped:** `webFetchOriginShape(subject)` — reduces a URL to `scheme//host[:port]`
via the native `URL` constructor (zero dependency), discarding path/query/fragment.
Learning happens at the *origin*, never the full URL: approving one fetch to
`https://docs.example.com/a` is not evidence `https://docs.example.com/b` is safe, let
alone a different domain. `proposeAllowRules` and `ratifyShape` now branch on
`entry.tool` (`Bash` → `commandShape`, `WebFetch` → `webFetchOriginShape`, anything else →
still never learned from — Edit/Write stay ask-only, unchanged). Poisoning (a shape that
ever hit a deny or softened deny is never proposed) now tracks `${tool}:${shape}` composite
keys so a Bash shape and a WebFetch origin that happen to share a string can never bleed
into each other's evidence.

**The one real security question this raises, answered directly:** could a proposed
WebFetch rule for `example.com` accidentally match `example.com.evil.com`? No — the
generated rule anchors with `^${escapeRegex(origin)}(?=[/?#]|$)`, a lookahead requiring a
path/query/fragment boundary or end-of-string immediately after the origin. A suffix
domain fails the lookahead and falls through to `ask`, same as today. Tested explicitly
(`the proposed WebFetch rule anchors to the origin and rejects a suffix-domain attack`).

**`ratifyShape`'s CLI contract is unchanged, deliberately.** `ideal-harness-guard ratify
<shape>` already joins all trailing args into one string with no tool flag. Rather than
add a second CLI argument, `ratifyShape` auto-detects: a `shape` that round-trips through
`webFetchOriginShape` unchanged is treated as a WebFetch origin, everything else as a Bash
shape. `ideal-harness-guard ratify "https://docs.example.com"` and
`ideal-harness-guard ratify "npm test"` both work with the exact same command shape
operators already know.

**Alternatives rejected:**
- A *new*, WebFetch-specific mechanism (separate store, separate CLI verb) — rejected;
  `VISION.md`'s own framing ("straightforward with the existing tier machinery") was the
  right call, and a second parallel mechanism for the same shape (ask repeatedly → ratify
  → standing allow rule) would be exactly the kind of overlap `DESIGN.md` §6 rules out.
- Learning at the full-URL grain instead of origin — rejected; a URL's path is
  request-specific, not evidence about the domain, and a full-URL rule would silently
  fail to generalize to the next page on the same trusted site, defeating the point.
- Extending this to `WebSearch` too — not done. `WebSearch` subjects are query strings,
  not URLs; `webFetchOriginShape` on a search query simply returns `''` (no shape, never
  learned from) today, which is correct behavior, not a gap — a search query has no
  stable "origin" to generalize to.

**Home:** `src/guard/learn.ts` (`webFetchOriginShape`, `shapeFor`, `buildRule`,
`proposeAllowRules`, `ratifyShape` — all modified; CLI in `src/guard/cli/index.ts`
untouched, no signature change needed), `test/guard/learn.test.ts` (+7 tests).

**Honesty check:** 377 tests total (was 370; +7, 0 regressions) — measured before and
after on this checkout, not asserted. `tsc --noEmit`, `biome check`, and
`node dist/core/cli/index.js validate` all clean.
