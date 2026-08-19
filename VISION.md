# VISION — What "An Actual Ideal Harness" Means

> Companion to DESIGN.md (the 9-layer architecture), CLAUDE.md (the live floor),
> decisions.md (why each call below was actually made, ADR-lite), and flow.md (the
> runtime sequences these capabilities produce). DESIGN.md says what we build and from
> where. This document says what the harness could *become* — the full possibility
> space, explored honestly: what ships today, what is planned, what is speculative, and
> what we refuse to build. Written 2026-07-07, after v0.1 (core, guard, compress,
> memory, orchestrate) and the operator-control work (floor modes, user policy tiers).

---

## 1. What "ideal" actually means

A harness is the deterministic control plane around a probabilistic model. The model
supplies judgment; the harness supplies memory, thrift, governance, structure, and
accountability. "Ideal" is not a feature count. It is five properties, held together:

1. **Right owner for every decision.** Judgment belongs to the model, instructions to
   the human, enforcement to the floor. An ideal harness never lets these blur — the
   model cannot soften the floor, the floor cannot override the human, the human is
   never silently overridden by either.
2. **Nothing invisible.** Every automatic action — a compression, a redaction, a
   denial, a softening, a memory write — is observable and explainable after the fact.
   Trust is a function of visibility, not of promises.
3. **Improves with use, never by itself.** The harness may *propose* changes to its
   own configuration from observed outcomes; a human ratifies every one. A
   self-modifying floor is not ideal, it is unaccountable.
4. **Useful at every scale of trust.** From `enforce` for a stranger's repo to
   `bypass` for a throwaway sandbox — the same harness serves both, because strictness
   is an operator dial, not an identity.
5. **Honest.** Numbers are measured, limits are stated, what doesn't travel to other
   hosts is named. A harness that overclaims is worse than no harness: it teaches
   misplaced trust.

"Help every person regardless of how they want to use it" therefore does NOT mean
maximal permissiveness or infinite features. It means the **dials reach everyone**
(§2) while the **core stays coherent** (§7). Universality through configuration,
not through sprawl.

### The five tensions an ideal harness must hold (not resolve)

| Tension | Resolution mechanism |
|---|---|
| Safety ↔ autonomy | Tiered, operator-owned floor: enforce / soft / bypass + user policy tiers (shipped) |
| Memory ↔ privacy | Workspace isolation by construction (shipped); crossing only by explicit consent (planned) |
| Automation ↔ transparency | Every automatic act journaled and queryable (planned: observe layer) |
| Power ↔ portability | Tier-1 deep on Claude Code, Tier-2 primitives everywhere, gap stated (shipped, honest) |
| Universality ↔ coherence | One mechanism per capability (DESIGN.md §6 anti-overlap), personas served by dials not forks |

---

## 2. Every person: the personas the harness must serve

| Persona | What "ideal" looks like for them | Status |
|---|---|---|
| **Solo dev on Claude Code** | Everything automatic: floor, compression, memory, statusline. Zero config. | v0.1 today |
| **The cautious beginner** | `strict` profile: more asks, and every denial *teaches* — names the rule, the risk, and the knob. Explain-mode as default. | Planned (profiles §4.3) |
| **The expert in flow** | `fast` profile: tuned allowlist proposed from their own ask-history, ratified once, then out of the way. Ask-fatigue is a real safety failure — people who are over-prompted stop reading prompts. | Planned (§4.3, §5.2) |
| **The team** | Policy-as-code: `ideal-harness.policy.json` reviewed in PRs; a shared tier *above* user policy so a team's agreed rules travel with the repo; shared structural memory, per-user episodic. | Mostly shipped — `.ideal-harness/team-policy.json` is git-tracked and PR-reviewed (leases > user > team > default); it's a committed file, not a managed/hosted service, by deliberate choice (decisions.md D014). Shared structural memory across teammates is still per-project, not cross-teammate. |
| **The enterprise operator** | Append-only, hash-chained audit journal of every decision; compliance export; centrally pinned floor no local softening can cross. | Planned (§4.2, §6.1) |
| **The non-Claude-host user** (Cursor, Codex, Gemini…) | Tier-2 MCP servers + CLIs (shipped), multi-host skill generation (shipped), and eventually a host shim that wraps any agent loop to restore automatic enforcement. | Partially |
| **The non-coder** (writer, researcher, ops) | Same floor, memory, compression over documents and web instead of code. Needs pluggable subject-extraction in the policy engine (today `subjectFor` is code-tool-centric). | Speculative (§6.3) |
| **The air-gapped / offline user** | Already served: zero runtime deps, no SaaS, project-local persistence, BM25 not embeddings-API. This is a *feature to protect*, not an accident. | v0.1 today |

The pattern: no persona gets a fork. Each gets a **profile** — a named bundle of floor
mode + policy tier + verbosity — over the same engine.

---

## 3. The five shipped modules: full possibility space

Each subsection: what exists → what it could become. Every ability names its home
module (anti-overlap holds).

### 3.1 `compress` → the context engine

Exists: deterministic tool-result compression (JSON sampling, log RLE, stack collapse),
CCR retrieval (lossless within a byte cap — 50 MiB default, operator-tunable, LRU-evicted
beyond it, `decisions.md` D035), token gate, caveman output mode (token-compression axis) +
focus output mode (structure/legibility axis — the two compose), context-window statusline.

Could become:

- **Working-set management.** Track which files/results are *hot* this task; when
  budget pressure rises, evict cold content to CCR pointers proactively instead of
  waiting for oversized results. The statusline already knows the pressure; today it
  only advises the human — it could also advise the compressor.
- **Pre-compaction handoff writer.** No hook can force `/compact` (honest boundary,
  plan.md), but the harness *can* keep a continuously-updated handoff summary (task
  state, open questions, key paths) so that when the human compacts, nothing
  load-bearing is lost. L1 triggers, L2 stores — the flush contract already designed.
- **Cross-turn dedup.** Same file read twice, same command rerun — second occurrence
  becomes a pointer to the first. Deterministic, cache-safe.
- **Prompt-cache-aware layout.** Never recompress the frozen prefix (already a
  principle); extend to *advising* stable prefix ordering so cache hits survive.
- **Semantic tier (speculative, opt-in).** Summarize-with-pointer for prose-heavy
  results (docs, issues) where structural compression does little. Breaks determinism
  — so it must stay opt-in, marked in the journal, and never touch code or errors.
- **Error-compression maturation.** Repeated identical failures collapse to
  `cause × count` (12-factor #9). Partially shipped; make it cover multi-tool loops.

### 3.2 `memory` → the knowledge engine

Exists: structural code-graph — regex tier by default, zero deps; an **optional** tree-sitter
tier (TS/TSX/JS/Python/Java/Kotlin/Go/Rust, degrading per-file to regex on any parse failure)
when the operator installs `web-tree-sitter` + grammar packages — with token-budgeted subgraph retrieval, now
persisted (`<root>/.ideal-harness/memory/graph.json`) and incrementally re-indexed (only changed
files are re-extracted); episodic recall — hand-rolled BM25 always available, upgrading to an
**optional** SQLite-FTS5 tier + lexical vector rerank (D041) on Node ≥22.5 via Node's own
built-in `node:sqlite`, no new dependency; curator (claims reconciled against tool evidence);
workspace isolation by construction. The drift-guard is sharper for it (§3.3): a structural
verdict built from an all-tree-sitter source set can legitimately hard-block.

**Shipped 2026-08-11:** decision ledger (as `decisions.md` — a file, not a store; see
decisions.md D020) · failure memory (`ObservationType: 'failure'`) · consolidation &
decay (`episodic/consolidate.ts`: dedup + prune-to-cap, exempting decision/failure/
security_alert) · provenance (`Observation.evidence`, stamped by `memory_write`) ·
consented sharing (the Obsidian bridge, CLI-only export/import — decisions.md D017).

Could become:

- **Tree-sitter tier on by default, wider still** — today's tier is optional (a devDependency
  the operator adds) and covers TS/TSX/JS/Python/Java/Kotlin/Go/Rust (Go and Rust shipped
  2026-08-19, issues #1/#2); making it a default install is the next step. LSP/SCIP remain
  further out.
- **Temporal memory.** Git-aware: *when* did X change, what did the file look like at
  the decision point. Answers "why is this here" — the question agents ask most.
- **Hybrid retrieval** — partially shipped 2026-08-19 (D041): SQLite-FTS5 first-stage +
  a lexical (hashed bag-of-words, cosine-similarity) vector rerank, both zero-dependency.
  BM25/FTS5 stays the deterministic default; the rerank is a blend, never the source of
  truth. What's still open: DESIGN.md L2's original envisioning was an *int8-vector* RRF
  rerank — real embeddings, not a lexical proxy — which needs an embedding source
  (bundled model weights or a network call) neither approved nor built here.
- **Provenance made mandatory**, not just available — today `evidence` is optional and
  stamped only when the caller supplies it; requiring it end-to-end is a further step.

### 3.3 `guard` → the trust engine

Exists: deny-wins fail-closed policy engine, tiered evaluation (user > default),
floor modes (enforce/soft/bypass) selectable directly or via named **profiles**
(`strict`/`default`/`fast`, `IDEAL_HARNESS_PROFILE` — a bundle, not a new mechanism), user
policy file with kill-switch, always-on secret redaction, injection fencing, skill vetting
(signatures + homoglyphs), a drift-guard authority ladder that now actually reaches
`treesitter` (`verify_symbol_structural` hard-blocks a symbol proven absent across an
all-tree-sitter source set), sandbox command builder, secrets broker.

**Shipped 2026-08-11:** audit journal (hash-chained, `verifyJournalChain`) · capability
leases (time/call-boxed, CLI-grant-only — decisions.md D016) · one-shot → standing-rule
ratification (`ratifyShape`/`ratifyFromJournal`, `guard ratify`) · a policy tier above
personal user policy — shipped as `.ideal-harness/team-policy.json`, git-tracked, **not**
a managed/hosted service (decisions.md D014; the "org-pinned, immune to local softening"
framing below was the aspiration — what shipped is "team-agreed, reviewed via normal
PRs," a deliberately smaller and more honest claim) · sandbox auto-application for
`ledger_verify`'s spawned command (not yet for every Bash call generally) · explain-mode
uniform across deny **and** ask, naming the rule id and operator knobs both ways.

Could become:

- **Path-scoped write capabilities.** "This task may write `src/compress/**` only."
  Orchestrate declares scope per task; guard enforces it. Blast-radius control for
  subagents. Still not built — leases (shipped) bound a capability by *time/count*, not
  by *path*; this is a different axis, still open.
- **Taint escalation.** Content that entered fenced as untrusted and later flows into
  a Bash command or Write → automatic escalation to ask. The fence today informs the
  model; taint tracking would *enforce* it. (Hard to do precisely; even a
  conservative same-turn heuristic beats nothing. Marked speculative.)
- **Egress domain allowlist.** First-use prompt per domain, remembered thereafter —
  Anthropic-checklist alignment, straightforward with the existing tier machinery.
- **General PreToolUse sandbox auto-application.** Shipped for `ledger_verify`'s own
  spawned command; wrapping an arbitrary risky Bash call automatically via
  `updatedInput` before it reaches the model's own tool execution is still open.
- **Dry-run / what-if mode.** `ideal-harness guard simulate <command|policy-file>`:
  show what would be denied/asked under a proposed policy before adopting it. Makes
  policy editing safe to experiment with.
- **A hosted/managed tier**, if ever — deliberately not pursued; the anti-SaaS anti-goal
  (§6.2) treats the git-tracked team tier as the correct shape for "centrally agreed,"
  not a stepping stone toward one.

### 3.4 `orchestrate` → the work engine

Exists: durable task ledger — every task may now carry a structural `verify: {command,
expect?}` field, set at creation time and round-tripped through serialize/parse and the
`ledger_add`/`ledger_update` MCP tools, with `implementer`/`reviewer` reading and writing it
explicitly instead of relying on brief prose ("done" is a measurement, not vibes — this was
this section's own highest-leverage call) — tool registry, loop/no-progress guard (SHA-256),
spend governor, API retry/backoff, checkpoint/resume, brainstorm HARD-GATE and
subagent-driven-development skills.

**Shipped 2026-08-11:** parallel fan-out with worktree isolation (`worktree.ts` —
real `git worktree` calls; merge/conflict gates and guard's path-scoped capabilities
are still open, see §3.3) · batch ask digest (`summarizeAsks`/`guard asks` — lives in
guard, since asks are guard's decision, but directly closes this line) · outcome retro
(`retro.ts`, `orchestrate retro`).

Could become:
- **Merge/conflict gates for fanned-out worktrees.** Worktree creation/removal is
  shipped; a controller-side policy for merging concurrent branches back (or detecting
  conflicting edits before merge) is not.
- **Stall → replan proposal.** The loop guard detects no-progress today; the upgrade
  is producing a concrete replan diff ("tasks 3–5 assumed X; X is false; propose…")
  for human approval, not just an alarm.
- **Model routing by task class (speculative).** Mechanical steps to a cheap model,
  judgment steps to a large one. Depends on host support; on Tier-2 the registry can
  hold cost hints and let the host route. Honest scope: advisory, not enforcement. An
  external comparison review (decisions.md D021) confirmed this is correctly *not* a
  gap — it's a host-dependent limitation stated honestly, not a missing feature.
- **Scheduled/background runs.** Long autonomous work in a governed lane: spend cap,
  checkpoint cadence, batch-ask on wake. The primitives all exist (spend governor, loop
  guard, ask digest, ledger checkpoint); this is wiring them into one scheduled entry
  point, not new mechanism.

### 3.5 `core` → the substrate

Exists: loader, manifest + frontmatter validation, dependency-free skill templating,
multi-host generation (claude/codex/gemini/cursor), MCP server harness, setup script, and
**`ideal-harness doctor`** (`scripts/doctor.mjs`, `pnpm run doctor`) — one command answering
are hooks wired, is dist built, do all 5 MCP servers actually boot and answer `initialize`,
is the policy file parseable, which floor mode is live, is `.ideal-harness/` writable.
Also shipped: `core render-skills` (below) and named profiles (§4.3).

**Shipped 2026-08-11, narrower than originally scoped here:** a host shim
(`core render-skills`) — but only for skill *text* (multi-host `SKILL.md` generation),
not for hook portability. See decisions.md D013: the "restores automatic enforcement on
hosts with no hook system" ambition below is explicitly **not** what shipped, and is
still the open, large, speculative build.

Could become:

- **Plugin API for third-party modules.** The five (now six) modules consume core's
  substrate; formalize that contract so others can build an L-something without forking.
- **Versioned config migrations.** Policy files and settings evolve; migrate them
  explicitly, never guess.
- **Host shim, the hook-portability half (the actual Tier-2 endgame).** A thin wrapper
  that runs any MCP-capable agent's tool loop *through* the guard/compress pipeline —
  restoring *automatic* enforcement on hosts with no hook system, not just portable
  primitives. This is the single biggest "every person" unlock, and honestly a large
  build. Still speculative until scoped; the skill-text half above is not a step toward
  this — it solves a different, smaller problem (content portability vs. execution
  portability).

---

## 4. The planned v0.2 layers, sharpened

DESIGN.md already commits to `web`, `skills`, `design`, `eval`. Exploration since
v0.1 sharpens two of them:

### 4.1 `eval` should be `observe` first
The layer's soul is not benchmarks — it is **visibility**: the unified event journal
(guard decisions, compressions, memory writes, ledger transitions), "why did that
happen" queries, session replay, and a local dashboard the statusline is the seed of.
Benchmarks then *read* that journal. Build the journal first, the eval harness second.

**Status (2026-08-11):** the journal (guard) existed; `scripts/report.mjs` now reads it
plus the ledger, graph, and episodic store into one static HTML report — the "local
dashboard" half, deliberately not a live server (decisions.md D015). Session replay and
structured "why did that happen" queries beyond grep/`memory_search` remain open.

### 4.2 `skills` must ship with the vetting gate on
The 700-skill noise problem (DESIGN.md §4) is the cautionary tale: an ideal harness
has a *curated* library where every third-party skill passes the vet scanner before
load. Quality bar, not quantity bar.

**Status:** the vet scanner (`vet_skill`) shipped in v0.1 and every skill added since
(`session-observer`, `focus`, `grill-with-docs`, `tdd`, `design-critique`) has passed it
clean. What's still open is the *library* half — a curated, discoverable multi-skill
catalog (the find-skills-style discovery pattern, DESIGN.md's 2026-08-10 addendum) —
the gate exists; the thing it gates at scale does not yet.

### 4.3 Profiles — shipped 2026-08-10
`strict` / `default` / `fast` (`src/guard/profiles.ts`) — named bundles selectable per
session via `IDEAL_HARNESS_PROFILE`. No new enforcement mechanism (anti-overlap: profiles
only *select* an existing knob) — today that's `floorMode` alone; the "explain verbosity"
axis this section originally proposed bundling has no real mechanism behind it yet, so
profiles honestly don't claim to select it. Precedence: bypass signals > explicit
`IDEAL_HARNESS_FLOOR_MODE` > profile > soft default; an unrecognized profile name fails to
`strict`, mirroring `floorMode`'s own rule for a broken `FLOOR_MODE` value.

---

## 5. The learning flywheel (the ability that makes it *ideal for each person*)

Everything above is static capability. The property that makes a harness ideal for
*a particular person* is that it fits them better every week — without ever modifying
itself. One loop, human-ratified at every edge:

```
observe (journal) → analyze (patterns) → propose (diffs) → human ratifies → adopt
```

Concrete proposals the loop can generate, each landing as a *reviewable diff*, never
an auto-apply:

- Repeated identical asks → narrow allowlist entry for the policy file (§3.3).
- Repeated dead-end approaches → failure-memory records (§3.2).
- Recurring context blowups → compression/working-set config tweaks (§3.1).
- Ledger retro patterns → skill edits ("plan tasks smaller in this repo").

The floor never learns on its own. The *proposals* learn; the human stays sovereign.
This is the same asymmetry the operator-control work established, extended from
enforcement into improvement.

---

## 6. What the ideal harness refuses to become (anti-goals)

Perfection here is substantially subtractive. Each refusal protects a property from §1:

1. **Not a model wrapper or router.** The harness governs tools and context; it does
   not proxy or re-prompt the model. (Protects: coherence, honesty.)
2. **Not a SaaS.** Local-first, zero runtime deps, works air-gapped. Telemetry, if
   ever, is local and readable. (Protects: privacy, the offline persona.)
3. **Not self-modifying.** No component may widen its own permissions or edit its own
   floor, in any mode. Proposals yes; ratification human. (Protects: right owner.)
4. **Not prompt-level safety.** Every guarantee is deterministic code below the model.
   A safety property that depends on the model's cooperation is a suggestion, not a
   property. (Protects: enforcement.)
5. **Not a skill landfill.** Curated, vetted, one mechanism per capability. The
   700-connector pile is the disease, not the goal. (Protects: coherence.)
6. **Not a pretender.** No "auto-compact" claims where no hook exists; no benchmark
   numbers that weren't measured; no "universal" without the Tier-2 caveat spoken.
   (Protects: honesty — the brand.)

---

## 7. Prioritized roadmap (opinionated)

> Shipped since this document was written (2026-07-07, same day): the guard decision journal,
> the learning loop v1 (`guard learn`, proposals-only), explain-mode denials, the read-only-git
> default allow, soft-as-default floor mode, and the scout/implementer/reviewer agents.
>
> Shipped 2026-08-10 (v2 Phase 1, prompted by a fresh audit against ~26 external repos — see
> CHANGELOG): the optional tree-sitter structural tier + persisted, incrementally-indexed graph
> (§3.2), drift-guard's structural tier actually reaching `treesitter` authority and hard-blocking
> proven-absent symbols (§3.3), verification-first ledger tasks (§3.4 — the item this section
> itself called the highest-leverage orchestration upgrade), `ideal-harness doctor` (§3.5),
> profiles (§4.3), and two new skills (`session-observer`, `focus`).
>
> Shipped 2026-08-11 (v2 Phase 2, "the flywheel, scale-out, every host, integration-ready" — see
> CHANGELOG): from v0.2 — audit journal (hash-chained), capability leases, one-shot→rule
> ratification, explain-mode uniformity on asks too, sandbox auto-apply for `ledger_verify`. From
> v0.3 — failure memory, decision ledger (`decisions.md`), consolidation/decay, batch ask digest,
> retro generator. From v0.4 — a git-tracked (not managed/hosted) team policy tier, a consented
> Obsidian export/import bridge, worktree fan-out, and the `web` module (fetch-scoped, §3.5/§4).
> From v0.5 — the host shim (skill-text rendering only, not hook portability) and the
> `design-critique` skill (folded in, not a new module). From v1.0 — a static observe report,
> provenance (`evidence`) on episodic records, verification gates wired default-on in the
> reviewer agent, and a re-measured, honestly-labeled benchmark addendum. **Not shipped, and not
> claimed:** managed/hosted policy (deliberately a file, see decisions.md D014), a live observe
> dashboard (deliberately static, D015), SQLite-FTS5/vector hybrid memory, LSP/SCIP drift-guard
> tiers, pluggable `subjectFor` for non-code domains, a skills-library discovery/vetting pipeline,
> model routing. An **external comparison review** (2026-08-11, recorded in `decisions.md` D021)
> independently confirmed the harness's anti-goals and identified the decision ledger as the one
> genuinely high-value gap remaining — closed the same day.
>
> Shipped 2026-08-19 (a backlog-clearing pass — v0.3.0, see CHANGELOG): the DNS-rebinding gap
> in `web`'s SSRF guard closed via connection pinning (D038); Go and Rust added to the
> tree-sitter tier (§3.2, now 8 languages); workspace-stamped structural graph snapshots;
> durable spend tracking that survives an MCP server restart, fail-closed (D037); a shared,
> zero-dependency file lock closing the concurrency gap across every persisted store in
> `memory` and `orchestrate` (D039); CCR's byte cap + LRU eviction (D035); real
> semgrep/osv-scanner integration tests, which immediately found 3 genuine parser bugs rather
> than a clean pass — disclosed as issue #36, not hidden; the OWASP Agentic Applications Top 10
> coverage table (`SECURITY-COVERAGE.md`); and an opt-in OTLP span exporter for the guard
> journal (`scripts/otel-export.mjs`, D040 — kept outside `src/guard/` by that module's own
> self-policy floor, which denies writing there even to add a read-only capability); and,
> later the same day, episodic recall's SQLite-FTS5 tier + lexical vector rerank (§3.2,
> D041) — via Node's own built-in `node:sqlite`, not a new dependency at all, degrading
> cleanly to the original hand-rolled BM25 tier on Node <22.5; and, in a follow-up release
> pass the same day, auto-applied compression/sandbox via the hook contract (issues #3/#4)
> and `vet_skill_deep`'s 3 parser bugs (issue #36) — all three needed edits inside files
> the self-policy floor protects, so a ready-to-apply patch was prepared for each and
> applied with explicit operator go-ahead (D043/D044), same as D025's precedent. **Not
> shipped, and not claimed:** full Windows sandbox parity (issue #35) — a verified-working
> process-tracking primitive shipped, but `buildSandboxCommand` still returns `ok: false`
> on `win32`; see `decisions.md` D043 for exactly what's still open and why.

Ordered by leverage-per-effort, respecting DESIGN.md's v0.2 commitments:

| Release | Theme | Contents | Status |
|---|---|---|---|
| **v0.2** | *Trust & visibility* | observe journal (§4.1) + `doctor` (§3.5); guard: audit journal, capability leases, one-shot→rule proposals, explain-mode uniformity, sandbox auto-apply; memory: tree-sitter tier; orchestrate: verification-first tasks; profiles (§4.3) | **Shipped** |
| **v0.3** | *The flywheel* | learning-loop proposals (§5); failure memory + decision ledger; consolidation/decay; batch ask queue; retro generator | **Shipped** |
| **v0.4** | *Scale-out* | policy tier above user (shipped as a git-tracked team file, not a hosted service); consented memory sharing (Obsidian bridge); parallel fan-out + worktrees; web layer (shipped fetch-scoped; interactive daemon/CDP automation still not built) | **Mostly shipped** — path-scoped write capabilities (blast-radius control per task) not built |
| **v0.5** | *Every host, every domain* | host shim (shipped, skill-text scope only — hook portability still doesn't travel); pluggable `subjectFor` + document workspaces (§2 non-coder); skills library with vetting gate (discovery pipeline); design layer | **Partially shipped** — non-coder `subjectFor` and a discovery-based skills library remain open |
| **v1.0** | *Accountable* | observe dashboard (shipped as a static report, not live); provenance contract on memory (shipped: `evidence` field); verification gates default-on (shipped); published, measured benchmark numbers (shipped, addendum) | **Mostly shipped** — "live dashboard" reading is deliberately not pursued (anti-SaaS); the rest holds |

## 8. Definition of "actually ideal" (testable)

The harness is ideal when every row holds, measurably — not when the feature list is long:

- [x] Every automatic action is in the journal and explainable in one query — hash-chained,
      `verify-journal` detects tampering. Session replay beyond that is still open.
- [x] Every softening (mode, disable, bypass) is loud at decision time *and* auditable later.
- [ ] Every memory record cites tool-call evidence — `evidence` is a real field
      (2026-08-11), stamped when the caller supplies it; not yet mandatory end-to-end.
- [x] Every "done" task was verified by its own stated check, not by assertion —
      `ledger_verify`, wired default-on in the reviewer agent.
- [x] Every persona in §2 is served by configuration, with zero forks — including the
      team persona now that the team policy tier is shipped (§2).
- [x] A new user reaches a working, honest floor in one command (`pnpm setup` /
      `/plugin install`); an expert tunes it without touching source (`ideal-harness.policy.json`,
      leases, profiles — all data, no source edits).
- [x] It runs fully offline — the only network calls anywhere are the explicitly
      policy-gated `web` module's fetches, off by default (WebFetch asks).
- [x] Every published number was measured, and the measurement ships with it —
      `BENCHMARK.md`'s 2026-08-11 addendum re-measured on a second, reproducible target
      and reported one unflattering result plainly alongside the good ones.
