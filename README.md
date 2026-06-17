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

Measured on a real codebase (the Voraxx worker source: 105 files, 33,629 LOC, indexed in 16 ms into 2,707 symbols; whole-repo secret scan covered 2,577 files). These are the only metrics we claim, and a couple of them are deliberately unflattering — the ones that *can't* be faked are the proof that the rest are real.

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
| `guard` | enforcement floor, below the model | Deny-wins / fail-closed policy engine with Anthropic-aligned defaults, prompt-injection wrapping, always-on secret redaction, a scoped secrets broker, a skill-vetting scanner (threat-signature DB + homoglyph / hidden-char detection), a drift-guard authority ladder that catches hallucinated symbols, and an OS sandbox command builder (Seatbelt / bubblewrap) with subprocess env-scrub. `PreToolUse` / `PostToolUse` hooks make all of it automatic. |
| `compress` | context economy | Deterministic, prompt-cache-safe `tool_result` compression — anomaly-preserving JSON sampling, log RLE, stack-trace collapse — gated by a token threshold, with a Compress-Cache-Retrieve (CCR) store for lossless recovery, plus the caveman output-side terse mode. |
| `memory` | recall | A structural code-graph with token-budgeted subgraph retrieval (recall structure, not whole files) and an episodic store ranked by real BM25 relevance, not recency, kept honest by a curator that reconciles claims against tool-call evidence. |
| `orchestrate` | control flow | Durable task ledger, tool registry, loop / no-progress guard, spend governor, API retry / backoff, session resume / checkpoint, plus subagent-driven-development and brainstorming (HARD-GATE) skills. |

## Universality, told honestly

This is **not** a multi-backend runtime. Portability comes in two tiers, and we draw the line where it actually is.

- **Tier 1 — deep, Claude Code-native.** `SessionStart` / `PreToolUse` / `PostToolUse` hooks, automatic guardrails, the full skill + plugin experience. The floor enforces itself with no cooperation from the model.
- **Tier 2 — any MCP-capable agent** (Cursor / Cline / Codex / Gemini). Every engine ships as a standalone MCP server and CLI, so other hosts get the tools *and* the enforcement primitives. Skills port via multi-host `SKILL.md` generation.

**What does not travel:** hook-driven *automatic* enforcement. On a Tier-2 host, nothing fires on its own — the host must call the policy, sandbox, and vetting CLIs itself. We would rather say this out loud than pretend the floor is free everywhere.

## What runs on every tool call (Tier 1)

When the model proposes a tool call, `guard` runs before the call executes and again on its result — all deterministic, none of it a prompt:

1. **Policy check.** Deny-wins, fail-closed. Credential reads, `rm -rf`, and writes to the policy file are denied; ambiguous actions become an ask, not a silent allow.
2. **Sandbox.** Shell commands are wrapped in a Seatbelt / bubblewrap profile with a scrubbed subprocess environment.
3. **Secret redaction.** The result is swept before it reaches the model or the logs — the same sweep that flagged 40 secret-shaped strings across 18 files on a 2,577-file repo.
4. **Compression.** Oversized `tool_result` payloads pass the token gate and get compressed cache-safe, with the original recoverable from the CCR store.
5. **Drift-guard.** Symbol references are checked against the code-graph, so a hallucinated symbol is flagged before it becomes a broken edit.

On Tier 2 the same five primitives exist as CLIs and MCP tools; the host decides when to call them.

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

The Ideal Harness is a pnpm monorepo that ships as a plugin marketplace. Each module installs independently; `core` is required.

```bash
# Tier 1 — install in Claude Code
# Add the marketplace, install core (required) plus whatever you want.
/plugin marketplace add bharat3645/The-Ideal-Harness
/plugin install ideal-harness-core@ideal-harness        # required
/plugin install ideal-harness-guard@ideal-harness
/plugin install ideal-harness-compress@ideal-harness
/plugin install ideal-harness-memory@ideal-harness
/plugin install ideal-harness-orchestrate@ideal-harness
```

```bash
# Tier 2 — run any engine as an MCP server / CLI (no Tier-1 host required)
npx @ideal-harness/guard mcp        # policy / sandbox / vet — MCP server (stdio)
npx @ideal-harness/memory mcp       # code-graph + episodic store
npx @ideal-harness/compress mcp     # tool_result compression + CCR
npx @ideal-harness/orchestrate mcp  # ledger / spend / loop guard
```

Point a Tier-2 host (Cursor / Cline / Codex / Gemini) at the MCP servers, or call the CLIs directly to invoke policy checks, sandboxing, and skill vetting yourself.

```bash
# develop the monorepo
pnpm install
pnpm build      # turbo build across packages
pnpm check      # type-check
pnpm test       # node:test, zero test-framework dependencies
pnpm validate   # the substrate validates its own repo
pnpm biome:fix  # lint + format
```

## Verification

- **74 unit tests** on `node:test` with zero test-framework dependencies.
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
