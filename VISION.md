# VISION — What "An Actual Ideal Harness" Means

> Companion to DESIGN.md (the 9-layer architecture) and CLAUDE.md (the live floor).
> DESIGN.md says what we build and from where. This document says what the harness
> could *become* — the full possibility space, explored honestly: what ships today,
> what is planned, what is speculative, and what we refuse to build. Written 2026-07-07,
> after v0.1 (core, guard, compress, memory, orchestrate) and the operator-control work
> (floor modes, user policy tiers).

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
| **The team** | Policy-as-code: `ideal-harness.policy.json` reviewed in PRs; a managed org tier *above* user tier (managed > user > default — mirrors Claude Code's managed settings); shared structural memory, per-user episodic. | Partially (user tier shipped; managed tier + shared memory planned) |
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
CCR lossless retrieval, token gate, caveman output mode, context-window statusline.

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

Exists: structural code-graph (grep tier) with token-budgeted subgraph retrieval,
episodic BM25 store, curator (claims reconciled against tool evidence), workspace
isolation by construction.

Could become:

- **Tree-sitter graph tier** (v0.2, already roadmapped) — real symbols, real edges;
  LSP/SCIP later. The drift-guard gets sharper for free.
- **Temporal memory.** Git-aware: *when* did X change, what did the file look like at
  the decision point. Answers "why is this here" — the question agents ask most.
- **Decision ledger.** Auto-extract "chose X over Y because Z" moments into durable,
  citable records. The single highest-value memory type for long-lived projects.
- **Failure memory.** Approaches that failed, with evidence. Fresh-context subagents
  burn most of their waste re-walking dead ends; this is the fix.
- **Consolidation & decay.** The curator periodically compacts stale episodes into
  semantic facts and drops what no evidence supports. Memory that only grows is a
  landfill, not a memory.
- **Provenance everywhere.** Every record cites the tool-call evidence it came from.
  A memory you can't trace is a rumor. (Curator partially does this — make it a
  contract, not a habit.)
- **Hybrid retrieval** — BM25 + int8-vector RRF rerank (DESIGN.md L2, deferred).
  BM25 stays the deterministic default; vectors are a rerank, never the source of truth.
- **Consented sharing.** Explicit export/import of memory bundles across projects or
  teammates. Isolation stays the default forever; crossing is a visible human act.

### 3.3 `guard` → the trust engine

Exists: deny-wins fail-closed policy engine, tiered evaluation (user > default),
floor modes (enforce/soft/bypass), user policy file with kill-switch, always-on secret
redaction, injection fencing, skill vetting (signatures + homoglyphs), drift-guard
authority ladder, sandbox command builder, secrets broker.

Could become:

- **Audit journal.** Append-only, hash-chained log of every decision: rule, mode,
  softenings, who bypassed when. The single feature that turns "trust me" into
  "check for yourself." Home: guard writes, observe (§6.1) reads.
- **Capability leases.** Time-boxed or count-boxed allows: "allow `git push` for
  30 minutes / for 3 uses." An approval that expires is safer than a standing rule,
  and *feels* safer, so humans grant it more honestly.
- **One-shot → standing-rule ratification.** When the human approves the same ask
  repeatedly, guard *proposes* the narrow allowlist entry (exact command shape, not a
  wildcard) — into the policy file only by human hand. Ask-fatigue reduction with the
  human in the loop. (The global /fewer-permission-prompts idea, done below the model.)
- **Path-scoped write capabilities.** "This task may write `src/compress/**` only."
  Orchestrate declares scope per task; guard enforces it. Blast-radius control for
  subagents.
- **Taint escalation.** Content that entered fenced as untrusted and later flows into
  a Bash command or Write → automatic escalation to ask. The fence today informs the
  model; taint tracking would *enforce* it. (Hard to do precisely; even a
  conservative same-turn heuristic beats nothing. Marked speculative.)
- **Egress domain allowlist.** First-use prompt per domain, remembered thereafter —
  Anthropic-checklist alignment, straightforward with the existing tier machinery.
- **Sandbox auto-application** (roadmapped) — PreToolUse `updatedInput` wraps risky
  Bash in Seatbelt/bubblewrap automatically instead of waiting to be asked.
- **Dry-run / what-if mode.** `ideal-harness guard simulate <command|policy-file>`:
  show what would be denied/asked under a proposed policy before adopting it. Makes
  policy editing safe to experiment with.
- **Managed tier.** A third tier above user: `managed > user > default`, pinned by an
  org, immune to local softening. The enterprise story, structurally identical to the
  user tier (shipped machinery reused).
- **Explain-mode denials.** Every deny/ask names the rule id, the risk in one plain
  sentence, and the operator knob that could change it. Teaching floor, not a wall.
  (Partially shipped — denials carry rule descriptions; make the knob-pointer uniform.)

### 3.4 `orchestrate` → the work engine

Exists: durable task ledger, tool registry, loop/no-progress guard (SHA-256), spend
governor, API retry/backoff, checkpoint/resume, brainstorm HARD-GATE and
subagent-driven-development skills.

Could become:

- **Verification-first tasks.** Every ledger task carries *how to verify* (command,
  expected observation) at creation time; the review gate runs it, not vibes. "Done"
  becomes a measurement. This is the highest-leverage orchestration upgrade.
- **Parallel fan-out with worktree isolation.** Independent tasks run concurrently in
  git worktrees; the ledger already models states, add merge/conflict gates. Guard's
  path-scoped capabilities (§3.3) keep the blast radii disjoint.
- **Batch ask queue.** HITL asks accumulate into a queue the human clears in one
  pass, instead of interrupt-per-item. Approvals get *more* thoughtful when they're
  not blocking a spinner. (12-factor #7 done humanely.)
- **Stall → replan proposal.** The loop guard detects no-progress today; the upgrade
  is producing a concrete replan diff ("tasks 3–5 assumed X; X is false; propose…")
  for human approval, not just an alarm.
- **Model routing by task class (speculative).** Mechanical steps to a cheap model,
  judgment steps to a large one. Depends on host support; on Tier-2 the registry can
  hold cost hints and let the host route. Honest scope: advisory, not enforcement.
- **Outcome retro.** The ledger already knows what shipped, was reworked, or died —
  a `retro` report generator turns it into a weekly honest summary. Feeds §5.
- **Scheduled/background runs.** Long autonomous work in a governed lane: spend cap,
  checkpoint cadence, batch-ask on wake. The primitives all exist; this is wiring.

### 3.5 `core` → the substrate

Exists: loader, manifest + frontmatter validation, dependency-free skill templating,
multi-host generation (claude/codex/gemini/cursor), MCP server harness, setup script.

Could become:

- **`ideal-harness doctor`.** One command: are hooks wired, is dist built, do the MCP
  servers start, is the policy file parseable, which floor mode is live, what got
  softened. Self-diagnosis is the first thing every confused user needs.
- **Plugin API for third-party modules.** The five modules consume core's substrate;
  formalize that contract so others can build an L-something without forking.
- **Versioned config migrations.** Policy files and settings evolve; migrate them
  explicitly, never guess.
- **Host shim (the Tier-2 endgame).** A thin wrapper that runs any MCP-capable
  agent's tool loop *through* the guard/compress pipeline — restoring automatic
  enforcement on hosts with no hook system. This is the single biggest "every
  person" unlock, and honestly a large build. Speculative until scoped.

---

## 4. The planned v0.2 layers, sharpened

DESIGN.md already commits to `web`, `skills`, `design`, `eval`. Exploration since
v0.1 sharpens two of them:

### 4.1 `eval` should be `observe` first
The layer's soul is not benchmarks — it is **visibility**: the unified event journal
(guard decisions, compressions, memory writes, ledger transitions), "why did that
happen" queries, session replay, and a local dashboard the statusline is the seed of.
Benchmarks then *read* that journal. Build the journal first, the eval harness second.

### 4.2 `skills` must ship with the vetting gate on
The 700-skill noise problem (DESIGN.md §4) is the cautionary tale: an ideal harness
has a *curated* library where every third-party skill passes the vet scanner before
load. Quality bar, not quantity bar.

### 4.3 Profiles (new, tiny, high-leverage)
`strict` / `default` / `fast` — named bundles of floor mode + policy tier + explain
verbosity, selectable per session (`IDEAL_HARNESS_PROFILE=strict`). No new
enforcement mechanism (anti-overlap: profiles only *select* existing knobs). This is
the cheapest way to serve the beginner and the expert from one engine.

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

Ordered by leverage-per-effort, respecting DESIGN.md's v0.2 commitments:

| Release | Theme | Contents |
|---|---|---|
| **v0.2** | *Trust & visibility* | observe journal (§4.1) + `doctor` (§3.5); guard: audit journal, capability leases, one-shot→rule proposals, explain-mode uniformity, sandbox auto-apply; memory: tree-sitter tier; orchestrate: verification-first tasks; profiles (§4.3) |
| **v0.3** | *The flywheel* | learning-loop proposals (§5); failure memory + decision ledger; consolidation/decay; batch ask queue; retro generator |
| **v0.4** | *Scale-out* | managed policy tier; consented memory sharing; parallel fan-out + path-scoped writes; web layer (daemon, extraction, research per DESIGN.md L3) |
| **v0.5** | *Every host, every domain* | host shim (§3.5); pluggable `subjectFor` + document workspaces (§2 non-coder); skills library with vetting gate; design layer |
| **v1.0** | *Accountable* | full observe dashboard; provenance contract on all memory; verification gates default-on; published, measured benchmark numbers — the honest-metrics brand as a release criterion |

## 8. Definition of "actually ideal" (testable)

The harness is ideal when every row holds, measurably — not when the feature list is long:

- [ ] Every automatic action is in the journal and explainable in one query.
- [ ] Every softening (mode, disable, bypass) is loud at decision time *and* auditable later.
- [ ] Every memory record cites tool-call evidence.
- [ ] Every "done" task was verified by its own stated check, not by assertion.
- [ ] Every persona in §2 is served by configuration, with zero forks.
- [ ] A new user reaches a working, honest floor in one command; an expert tunes it without touching source.
- [ ] It runs fully offline.
- [ ] Every published number was measured, and the measurement ships with it.
