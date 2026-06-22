# The Ideal Harness

**The control-plane OS around a stateless model — it turns probabilistic reasoning into deterministic, governed, safe action.**

An agent harness with deep Claude Code integration and an MCP-portable enforcement and tooling core.

`github.com/bharat3645/The-Ideal-Harness` · MIT · built by Bharat

---

## The problem

Every "best harness" is a partial.

- The **skills** project gives you reusable workflows, but no enforcement — a skill can tell the agent to run `curl … | bash` and nothing stops it.
- The **memory** project remembers, but does not compress — it hands the model whole files and burns the context window it was meant to save.
- The **compression** project compresses, but does not remember — it shrinks one tool result and forgets the rest of the session.
- The **orchestration** project sequences work, but assumes you *are* the harness — it lives inside one host, and the moment you switch agents the guarantees evaporate.

Each one is real and good. None of them is the whole stack. Wire four of them together and you get four overlapping notions of "state," two competing policy stories, and a safety floor that is really just a polite paragraph in a prompt.

So we built the one that has every layer, with no overlap.

## What it is

The Ideal Harness is the control-plane OS around a stateless model: it turns probabilistic reasoning into deterministic, governed, safe action. It is a clean-room synthesis of best-of-breed ideas from ~30 leading harness, skill, memory, and web repos — Superpowers, gstack, gsd-core, hermes, omnigent, headroom, graphify, claude-mem, chrome-devtools-mcp, impeccable, SkillSpector, last30days, firecrawl, and others — rationalized into **one coherent monorepo where every capability has exactly one home**. One chosen mechanism per capability. The alternatives we rejected are documented, not silently dropped.

We read those ~30 repos to ground truth, took the best idea from each, and threw away the vaporware. What survived is five modules that share one substrate and one enforcement floor, with zero feature overlap between them.

The safety layer is not advice to the model. It is deterministic code that runs **below** the model, on `PreToolUse` / `PostToolUse` hooks. The model proposes; the floor disposes.

## The numbers

Measured on a real codebase (the Voraxx worker source: 105 files, 33,629 LOC, indexed in 16 ms into 2,707 symbols; whole-repo secret scan covered 2,577 files). These are the only metrics we claim, and a couple of them are deliberately unflattering — the ones that *can't* be faked are the proof that the rest are real. The Voraxx corpus is external and is **not** bundled in this repo, so these exact token counts can't be re-run from here; the methodology and per-case breakdown are in [`BENCHMARK.md`](./BENCHMARK.md), and the compressors themselves are covered by the in-repo unit tests.

| Capability | Measurement | Result |
|---|---|---|
| **Context (code-graph)** | answer a code question via token-budgeted subgraph vs reading the files | ~1,988 tokens vs 17,323–37,369 → **8.7x–18.8x** less |
| **Compression (structured)** | 2,707-row JSON tool output | 100,728 → 196 tokens → **99.8% saved** |
| **Compression (log)** | 2,969-line grep log, mostly unique lines | 91,544 → 88,402 tokens → **3.4% saved** |
| **Secret redaction** | swept 2,577 files | flagged 40 secret-shaped strings across 18 files |
| **Policy engine** | 10 realistic requests | 2 allow / 4 ask / 4 deny |
| **Drift-guard** | 3 real symbols + 1 fabricated | 3 found, 1 flagged missing, 0 false hard-block |
| **Malicious-skill vet** | skill with `curl … \| bash` + "ignore all previous instructions" | blocked (high severity) |

On the honest ones:

- **3.4% on the grep log is the whole point.** Unique lines barely compress, so we report it plainly. Structured output collapses from 100,728 to 196 tokens; an unstructured log does not. A harness that claimed otherwise would be lying.
- **The 40 secret-shaped strings** include test fixtures; the named categories break down as jwt 10, private-key 5, bearer 5, aws 2, anthropic 1, github 1, with the remainder in unnamed categories. The claim is *deterministic detection before anything reaches the model or the logs* — not "this repo is leaking."
- **The policy denials** were credential reads, `rm -rf`, and a write to the policy file itself. The floor refuses to let the agent edit its own floor.
- **The drift-guard** was handed 3 real symbols and 1 invented one: it found all 3, flagged the fabricated one missing, and hard-blocked nothing real. Hallucinated symbols get caught before they become broken edits.
- **The vetting scanner** blocked a skill carrying `curl … | bash` and "ignore all previous instructions" at high severity — before it could be installed, not after it ran.

## The five modules (v0.1)

Each is an independently installable plugin; `core` is required. Every engine also runs as a standalone MCP server and CLI.

| Module | Role | What lives here |
|---|---|---|
| `core` | substrate | Plugin loader, manifest + skill validation, dependency-free skill templating with multi-host generation (Claude Code, Codex, Gemini, Cursor), a bootstrap skill, and the minimal MCP stdio server every other engine reuses. |
| `guard` | enforcement floor, below the model | Deny-wins / fail-closed policy engine with Anthropic-aligned defaults, prompt-injection wrapping, always-on secret redaction, a scoped secrets broker, a skill-vetting scanner (threat-signature DB + homoglyph / hidden-char detection), a drift-guard authority ladder that catches hallucinated symbols, and an OS sandbox command builder (Seatbelt / bubblewrap) with subprocess env-scrub. `PreToolUse` / `PostToolUse` hooks make **policy, outbound-secret blocking, secret redaction, and injection fencing** automatic; sandbox, vetting, drift-guard, and the broker are MCP tools / CLIs the host invokes (see below). |
| `compress` | context economy | Deterministic, prompt-cache-safe `tool_result` compression — anomaly-preserving JSON sampling, log RLE, stack-trace collapse — gated by a token threshold, with a Compress-Cache-Retrieve (CCR) store for lossless recovery, plus the caveman output-side terse mode. |
| `memory` | recall | A structural code-graph with token-budgeted subgraph retrieval (recall structure, not whole files) and an episodic store ranked by real BM25 relevance, not recency, kept honest by a curator that reconciles claims against tool-call evidence. |
| `orchestrate` | control flow | Durable task ledger, tool registry, loop / no-progress guard, spend governor, API retry / backoff, session resume / checkpoint, plus subagent-driven-development and brainstorming (HARD-GATE) skills. |

## Universality, told honestly

This is **not** a multi-backend runtime. Portability comes in two tiers, and we draw the line where it actually is.

- **Tier 1 — deep, Claude Code-native.** `SessionStart` / `PreToolUse` / `PostToolUse` hooks, automatic guardrails, the full skill + plugin experience. The floor enforces itself with no cooperation from the model.
- **Tier 2 — any MCP-capable agent** (Cursor / Cline / Codex / Gemini). Every engine ships as a standalone MCP server and CLI, so other hosts get the tools *and* the enforcement primitives. Skills port via multi-host `SKILL.md` generation.

**What does not travel:** hook-driven *automatic* enforcement. On a Tier-2 host, nothing fires on its own — the host must call the policy, sandbox, and vetting CLIs itself. We would rather say this out loud than pretend the floor is free everywhere.

## What runs automatically on every tool call (Tier 1)

Two `guard` hooks fire deterministically around every tool call — no prompt, no model cooperation. This is the floor that runs **on its own**:

**PreToolUse — before the call executes:**

1. **Policy check.** Deny-wins, fail-closed. Credential reads, `rm -rf`, and writes to the policy file are denied; ambiguous actions become an ask, not a silent allow.
2. **Outbound-secret block.** Egress tools (`Bash`, `Write`, `Edit`, `WebFetch`) are scanned; a call that would carry a secret out is blocked before it runs.

**PostToolUse — on the result, before the model reads it:**

3. **Secret redaction.** The result is rewritten with secrets masked as `[REDACTED:type]` (via the `updatedToolOutput` contract) before the model sees it — the same detector that flagged 40 secret-shaped strings across 18 files on a 2,577-file repo.
4. **Injection fencing.** Web/MCP output, or any result tripping an injection cue, is wrapped in a breakout-safe `<untrusted_content>` fence so the model treats it as data, not instructions.

**At SessionStart**, the `using-ideal-harness` bootstrap skill is injected so the model knows the floor is active and how to route.

## Tools the agent or host invokes — deterministic, but not automatic

These are the rest of the floor and the engines. They are real, deterministic code exposed as **MCP tools and CLIs** — the model or host calls them deliberately; they are not (yet) hook-applied. Auto-applying sandbox (via PreToolUse `updatedInput`) and compression (via PostToolUse `updatedToolOutput`) is the next wiring step on the roadmap.

- **Sandbox** — `buildSandboxCommand` wraps a shell command in a Seatbelt / bubblewrap profile with a scrubbed env (CLI / primitive).
- **Compression + CCR** — `compress_tool_result` shrinks oversized JSON / logs cache-safe; `ccr_retrieve` recovers the original.
- **Drift-guard** — `verify_symbol` checks a symbol against the code-graph before you rely on it.
- **Skill vetting** — `vet_skill` scans a skill (threat-signature DB + homoglyph / hidden-char) before you install it.
- **Memory** — `query_graph`, `memory_search`, `memory_write`, `reconcile`, `add_file`.
- **Orchestrate** — `ledger_add` / `ledger_update` / `ledger_status`, `loop_check`, `spend_check`.

On Tier 2 (any MCP host) every item in **both** lists is reachable as the same MCP servers / CLIs; only the automatic hook application above is Claude-Code-specific.

## Context-budget statusline (Tier 1)

Claude Code's bottom line carries a live context-window meter — `IH <used>/<window> <pct>%` (e.g. `IH 142k/1M 14%`) — showing the tokens spent and the share of the model's **total context window** they occupy. It advises `⚠ consider /compact or /clear` past 14% and `⚠ /compact or /clear for better results` past 17%, with a `· filling fast` flag when a single turn adds a lot. It is **display + advice only**: Claude Code exposes no hook to force `/compact` mid-session, so the harness never auto-compacts. The advisory band is a *soft* quality line — answers degrade as the window fills — **not** the model's hard limit; native auto-compact stays the hard-limit backstop, and `compress`'s tool-result shrinking slows the fill. The window is **not hardcoded** — the hook reads the active model's real window from Claude Code's `context_window.context_window_size` (200k by default, 1M for extended-context models), so the percentage is correct on whatever model you run; `IDEAL_HARNESS_BUDGET_WINDOW` overrides it and ~1M is only a fallback when the host reports no window. The classification is pure, unit-tested logic in `compress`; the statusline hook reads tokens spent + window straight from Claude Code (or falls back to the transcript) and fails open to `IH —`.

## Principles

- **Enforce below the model.** Every safety and scope rule is deterministic code — a hook, a gate, a scanner — never a polite request in a prompt.
- **Zero overlap.** One chosen mechanism per capability; the rejected alternatives are documented, not deleted in silence.
- **Honest by default.** A 3.4% compression number and a v0.1 scope note are features. The metrics we cannot fake are the evidence for the ones you cannot easily check.
- **Standards-aligned.** 12-Factor Agents compliant; aligned with published context-engineering and long-running-harness guidance and OWASP LLM06 (excessive agency).

## Architecture

```
                      ┌─────────────────────────────┐
   model proposes ──► │            guard            │ ◄── deny-wins, fail-closed
   a tool call        │  policy · sandbox · vet ·   │     PreToolUse / PostToolUse
                      │  redaction · drift-guard    │     enforcement floor
                      └──────────────┬──────────────┘
                                     │ allowed call
        ┌──────────────┬─────────────┼─────────────┬──────────────┐
        ▼              ▼             ▼             ▼              ▼
   ┌─────────┐   ┌──────────┐  ┌──────────┐  ┌───────────┐ ┌──────────────┐
   │  core   │   │ compress │  │  memory  │  │orchestrate│ │  (your tool) │
   │substrate│   │ context  │  │  recall  │  │  control  │ │              │
   └─────────┘   └──────────┘  └──────────┘  └───────────┘ └──────────────┘
        │
   every engine = a plugin (Tier 1)  +  an MCP server / CLI (Tier 2)
```

`guard` sits between the model and every tool. The other engines run as plugins in Claude Code (Tier 1) and as MCP servers or CLIs anywhere else (Tier 2).

## Install & quickstart

The Ideal Harness ships as a Claude Code **plugin marketplace** backed by npm. Each module is an independently installable plugin; `core` is required. **Install once, machine-wide** — plugins install at user scope and are available in every project.

### Tier 1 — install in Claude Code (recommended)

```bash
# Add the marketplace, then install core (required) plus whatever you want.
# Each plugin is sourced from npm, so its built code, hooks, and MCP server
# install and wire up automatically — no clone, no build, no .mcp.json editing.
/plugin marketplace add bharat3645/The-Ideal-Harness
/plugin install ideal-harness-core@ideal-harness        # required
/plugin install ideal-harness-guard@ideal-harness        # the enforcement floor
/plugin install ideal-harness-compress@ideal-harness
/plugin install ideal-harness-memory@ideal-harness
/plugin install ideal-harness-orchestrate@ideal-harness
```

Each plugin's `source` is its npm package (`@ideal-harness/*`); installing it pulls the published tarball (which includes `dist/`, hooks, and skills) into `${CLAUDE_PLUGIN_ROOT}`, so the floor and tools work immediately. Approve the MCP servers once when prompted.

### Tier 2 — run any engine as an MCP server / CLI (any MCP host)

```bash
npx -y @ideal-harness/guard mcp        # policy / vet / drift / redact — MCP (stdio)
npx -y @ideal-harness/memory mcp       # code-graph + episodic store
npx -y @ideal-harness/compress mcp     # tool_result compression + CCR
npx -y @ideal-harness/orchestrate mcp  # ledger / spend / loop guard
```

Point a Tier-2 host (Cursor / Cline / Codex / Gemini) at the MCP servers, or call the CLIs directly to invoke policy checks, sandboxing, and skill vetting yourself.

### Develop from source (no publish needed)

Working on the harness itself, or running it before the packages are published? Build once and point any project at the local checkout:

```bash
git clone https://github.com/bharat3645/The-Ideal-Harness && cd The-Ideal-Harness
pnpm install
pnpm build                       # all engines (or: pnpm -r run build)
pnpm test                        # node:test, zero test-framework deps
pnpm validate                    # the substrate validates its own repo

pnpm setup                       # wire the harness into THIS directory, or…
pnpm setup /path/to/your/project # …any project — writes .claude/settings.json + .mcp.json
```

`pnpm setup` is idempotent; restart the session and approve the MCP servers once.

### Releasing (maintainers)

```bash
pnpm release:dry   # build + pack everything, no publish — inspect what ships
pnpm release       # build + publish every @ideal-harness/* to npm (needs npm auth)
```

Tag `vX.Y.Z` to publish via CI (`.github/workflows/release.yml`, needs the `NPM_TOKEN` secret).

## Verification

- **130 unit tests** on `node:test` with zero test-framework dependencies.
- Biome clean, fully type-checked.
- CI runs biome + build + check + test + validate + a skill-threat self-scan on every change.
- **Dogfooded.** The substrate validates its own repo; the code-graph indexes its own source.

## v0.1 scope, stated plainly

Honesty is the brand, so here is exactly where v0.1 stands.

- **5 of 9 designed modules ship now.** `web` (browser + scrape + research), `skills` (the SDLC library), `design` (taste linter), and `eval` land in v0.2.
- **Clean-room depth is deliberate, with the upgrade path already drawn behind a stable contract:**
  - the code-graph uses regex today; tree-sitter is the v0.2 upgrade behind the same interface.
  - the episodic store is in-memory today; SQLite-FTS5 + vector search is v0.2.
  - drift-guard uses a grep tier today; LSP / SCIP is v0.2.

Nothing here is overclaimed. The contracts are fixed; the engines behind them get sharper.

## License

MIT.
