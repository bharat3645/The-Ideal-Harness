# V2 Execution Plan — Session Context for Continuing Development

> Written 2026-08-18. Purpose: a differently-contexted session — a human working in a
> local IDE with none of this conversation's history, or a fresh agent spawned without
> it — should be able to read this one file and recover the reasoning behind the
> current sprint without re-deriving it. `decisions.md` records the *why* behind each
> shipped decision (D0xx, append-only, ADR-lite). This file records the *what's left*
> and *how to pick the next item up* — a living tracker, not a ledger; update it as
> items ship rather than appending forever.

## 1. What this sprint is, and what it explicitly is not

This sprint started from evaluating DeepSeek Harness (`dsh`, launched 2026-08-13) and
its underlying meta-framework Cordis against this project, prompted by their surface
similarity to what this project already does. The conclusion, recorded fully in
**`decisions.md` D036**:

- **Not adopting `@cordisjs/core` as a dependency, anywhere.** It would violate D007
  (zero runtime dependencies) regardless of staging, and its core differentiator — a
  self-modifying, hot-swappable agent loop — is architecturally opposed to D003 (fixed
  floor below the model) and D006 (no self-modification).
- **Not building a self-modifying loop or hot-swap agents.** Same reasoning.
- **Tracking, not adopting, DeepSeek Harness's sandbox posture.** Independent reviews
  found their sandbox covers filesystem only, not network/process — currently a gap on
  their side, not something to copy. Worth re-checking periodically in case it matures;
  nothing to act on today.
- **The one legitimate idea worth remembering:** multi-provider routing as a pattern,
  and Cordis's own rollback/DI discipline as a design *influence* — neither is built
  into this codebase, and if `orchestrate`'s speculative model-routing line (`VISION.md
  §3.4`) is ever picked up, it should be built the way `plan-critic` (D028) was: native
  Claude Code mechanisms, zero new dependencies, not an import of theirs.

**An earlier draft plan in this same sprint (`ideal-harness-v2.1-plan.md`, a local file,
not part of this repo) proposed the opposite** — staged Cordis adoption, a new `route`
module, a `design` module as a standalone package, three-platform sandbox hardening as
one blast. That plan was built from a stale README read, without checking the actual
source tree, `VISION.md`, `decisions.md`, or `ROADMAP.md` first. It led to 12 GitHub
issues being opened against gaps that were mostly already closed or already correctly
rejected. All were closed with `not_planned`/`duplicate` and a correction comment on
the tracking issue. **The lesson, stated plainly so it isn't repeated:** always verify
against the actual current source and its own docs before planning against it — a
README, or a memory of one, is not the source of truth here.

## 2. The actual shipping methodology (the loop)

Source of truth for "what's left to build" is **`VISION.md`'s per-module "Could
become" lists (§3.1–§3.5)**, cross-checked against **`decisions.md`'s** historical
record — not the README, not a prior session's summary, not this file's own memory of
either without a fresh read.

**Community-filed issues (#1–#20 on the GitHub tracker, see `ROADMAP.md`) belong to the
community.** Only pick one up if it's a genuine, concrete blocker to something in this
plan. Otherwise leave it — other contributors are actively working those.

**Per-item process** — this is the exact loop `decisions.md` D035 (egress domain
allowlist, PR #33) followed, and the template for every item after it:

1. Fetch `main`'s current `VISION.md`, `decisions.md`, `CLAUDE.md`, and `ROADMAP.md` —
   confirm the chosen item is still genuinely unbuilt. Don't trust a cached
   understanding, including this file's own backlog table below — re-verify.
2. Implement with **zero new runtime dependencies** (a devDependency is fine only under
   the same bar `web-tree-sitter`/`ws` already met: optional, presence-detected or
   dynamically imported, degrading cleanly to absence).
3. Write real tests. Get an honest before/after test count via `git stash` /
   `git stash pop` around a `corepack pnpm test` run — never assert a count without
   measuring it both ways on the same checkout.
4. Add a `decisions.md` entry in the established format (Date / Status / Decision / Why
   / Alternatives rejected / Home) — **check `main`'s current tip immediately before
   writing** for the next sequential D-number, since parallel work may have landed
   entries in the meantime. Always name what the change does **not** close, not just
   what it does.
5. Add a `CHANGELOG.md` entry under `## Unreleased`, referencing the decision.
6. Run the full pipeline and confirm all green: `corepack pnpm run check`,
   `corepack pnpm run test`, `corepack pnpm run biome`, `corepack pnpm run build`,
   `corepack pnpm run validate` (`node dist/core/cli/index.js validate`).
7. Push to a new branch, open a scoped PR that cites the decision entry and the honest
   test-count delta.
8. Never touch `.claude/settings.json`, `.claude-plugin/*`, or anything under
   `src/guard/**`'s existing enforcement *contracts* destructively; never touch another
   contributor's already-open PR; never merge a PR without the human's go-ahead.

**On decisions.md numbering collisions:** multiple branches in flight will sometimes
both claim the same next D-number before either merges. This is expected, not an
error — same as any real multi-contributor repo. Resolve at merge time by renumbering
whichever entry merges second; do not block work waiting for the other to land first.

## 3. Status tracker

Update this table as items ship or as scope changes. Do not let it drift stale —
if you finish an item, mark it here in the same PR that ships it.

| Item | Module | Status | PR | Decision |
|---|---|---|---|---|
| Egress domain allowlist | `guard` | Shipped | #33 | D035 |
| Cordis/DeepSeek Harness evaluation | — | Decided, recorded | — | D036 |
| This execution plan | — | Shipped | (this PR) | D037 |
| Dry-run / what-if mode (`guard simulate`) | `guard` | In progress (agent-spawned) | TBD | TBD |
| Cross-turn dedup | `compress` | In progress (agent-spawned) | TBD | TBD |
| Path-scoped write capabilities | `guard` | Queued | — | — |
| Taint escalation | `guard` | Queued — speculative, marked hard in VISION.md itself | — | — |
| General PreToolUse sandbox auto-application (beyond `ledger_verify`) | `guard` | Queued | — | — |
| Merge/conflict gates for fanned-out worktrees | `orchestrate` | Queued | — | — |
| Stall → replan proposal | `orchestrate` | Queued | — | — |
| Scheduled/background runs | `orchestrate` | Queued — needs a design pass on what "scheduled entry point" means outside Claude Code before implementing | — | — |
| Temporal memory (git-aware "when did X change") | `memory` | Queued | — | — |
| Provenance made mandatory (not just available) | `memory` | Queued — flagged as a possible breaking change; needs a migration decision before implementing | — | — |
| Working-set management | `compress` | Queued | — | — |
| Pre-compaction handoff writer | `compress` | Queued | — | — |
| Plugin API for third-party modules | `core` | Queued — larger, needs a design pass | — | — |
| Versioned config migrations | `core` | Queued | — | — |
| Host shim (hook-portability half) | `core` | Explicitly speculative per VISION.md itself — do not attempt without a dedicated scoping pass first | — | — |

## 4. Open threads / things needing a human call

- **PR #33** (egress domain allowlist, D035) is open, awaiting review/merge.
- **This PR** (docs: D036, D037, this file, the CLAUDE.md pointer) is open, awaiting
  review/merge.
- **`ideal-harness-v2.1-plan.md`** referenced in §1 above lives outside this repo (a
  local planning file from earlier in this sprint) — it is stale/superseded, no repo
  action needed, just don't trust it if you encounter a copy of it anywhere.
- DNS-rebinding residual risk in `web`'s SSRF guard (D026) remains open by design —
  stated, not hidden, not scheduled.
- Numbering collisions in `decisions.md` between parallel in-flight PRs are expected —
  see §2's last paragraph.

## 5. For a session picking this up cold (e.g. tomorrow's IDE session)

Read, in this order: this file → `decisions.md`'s most recent entries (search for the
highest `D0xx`) → `VISION.md §3` and `§7` → `CLAUDE.md` (now points here). That recovers
full context faster than reading the whole git history.

`CLAUDE.md` now has a "Continuing the v2 backlog" section pointing at this file, so a
fresh Claude Code session in this repo picks this up automatically at `SessionStart` —
no need to paste this context in manually.

Everything referenced as "Shipped" or "In progress" in the table above is real, tested
code on its own branch/PR — safe to review, merge, or build directly on top of,
independently of whatever else is still queued.
