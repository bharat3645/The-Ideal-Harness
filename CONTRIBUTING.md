# Contributing to The Ideal Harness

Thanks for wanting to make the harness better.

**Never contributed to an open-source project before?** Start at
[Your first contribution](#your-first-contribution) further down — it walks the whole
thing, including the git mechanics. You are not expected to already know how this works.

**Been here before?** The principles below are the short version of what review checks for.

## Principles

1. **Enforce below the LLM.** Every safety or scope rule is deterministic code — a hook,
   a gate, a linter — never a polite request in a prompt. If a rule can be bypassed by
   the model "deciding" to ignore it, it belongs in `guard`, not in a system prompt.
2. **Zero overlap.** Each capability has exactly one home. Before adding something, check
   `DESIGN.md §6` — if the capability already exists, extend it; don't add a second one.
3. **Clean-room.** We lift *ideas*, not code. Implement the algorithm fresh, with your own
   tests. No vendored sources, no copied files.
4. **Honest by construction.** Don't claim a capability you can't measure. If a tier is a
   heuristic (e.g. the grep drift tier), say so and don't let it pretend to be authoritative.

## Setup

```bash
pnpm install
pnpm build      # one tsc project: src/ -> dist/
pnpm check      # type-check (strict, exactOptionalPropertyTypes)
pnpm test       # node:test, zero test-framework deps
pnpm biome:fix  # lint + format (single quotes, 2-space, 120col)
```

A change is not done until `pnpm build && pnpm check && pnpm test && pnpm biome` are all
green, `node dist/core/cli/index.js validate .` passes, and every `SKILL.md` you
touched passes `node dist/guard/cli/index.js vet <file>`.

> **Build from source, not from npm.** The published `ideal-harness` package is currently
> behind this repo — see the publish-freshness note in `README.md`. For development, the
> local checkout is the only path that gets you what the docs describe.

## Your first contribution

### 1. Find something to work on

Issues labelled **`good first issue`** are chosen so you can finish them without
understanding the whole system. Each one names the files involved and what "done" looks
like.

Comment on the issue saying you're taking it. That's it — no formal assignment process.
It stops two people building the same thing.

If an issue is unclear, say so in the issue. An unclear issue is the maintainer's bug, not
your comprehension problem.

### 2. Get it running

```bash
# Fork the repo on GitHub (button, top right), then:
git clone https://github.com/YOUR-USERNAME/The-Ideal-Harness
cd The-Ideal-Harness
pnpm install
pnpm build
pnpm test          # should be all green before you change anything
```

If `pnpm test` isn't green on a fresh clone, that's a bug — open an issue.

### 3. Make the change

```bash
git checkout -b add-go-treesitter    # short, descriptive
```

Small commits with clear messages. Write the test alongside the code, not after.

### 4. Open the pull request

```bash
git push origin add-go-treesitter
```

GitHub will offer a "Compare & pull request" button. The PR template asks what you changed,
why you chose that approach, and confirms the checks pass. Fill it in honestly — including
the "anything unflattering" section, which is genuinely wanted and not a trap.

### 5. Review

Expect comments. Review here is about the code, and questions are questions, not
accusations. If you disagree with a review comment, say so and explain why — that's a
normal part of the process, not a confrontation.

If you get stuck at any point, comment on the issue. A half-finished PR with a question
attached is far more useful than silence.

## Finding your way around the codebase

Reading a codebase you didn't write is a skill. This one is documented specifically to make
it possible:

| Read this | To understand |
|---|---|
| `README.md` | What each of the six modules does and what runs automatically |
| `DESIGN.md` | The 9-layer architecture, and which external ideas were adjudicated in |
| `decisions.md` | **Why** every scope call was made — alternatives considered and what lost |
| `flow.md` | The actual runtime sequence for each flow, as diagrams |
| `VISION.md` | Where this is going, and the anti-goals |
| `BENCHMARK.md` | What has been measured, and the methodology |

If you're about to ask "why isn't this done the obvious way," check `decisions.md` first —
the answer is usually there, recorded at the time with the reasoning.

## Adding a module

Each module lives in `src/<module>/` with a clean public `index.ts`, and exposes up to three
faces where it makes sense — Claude Code skills/hooks, a standalone MCP server
(`src/<module>/runtime/mcp.ts`, built on `createMcpServer` from core), and a CLI
(`src/<module>/cli/index.ts`). Add the CLI as a `bin` and a subpath `export` in the root
`package.json`, and register any MCP server in `.claude-plugin/plugin.json`.

## Code style

- `function` keyword for top-level functions; explicit return types on exports.
- `Result<T,E>` over throwing for fallible operations.
- Early returns and guard clauses over deep nesting; no nested ternaries.
- Comments are timeless: explain the non-obvious *why*, never the edit history.

## Commits

Small, focused commits with a clear message. Branch off `main`; open a PR. CI must be green.

## Ways to help that aren't code

All of these are real contributions and all of them are wanted:

- **Run it on a Tier-2 host** (Cursor, Cline, Codex, Gemini) and report what happens. Tier 2
  is shipped but not systematically exercised — see the open issue.
- **Try the quickstart on a fresh machine** and note every place it doesn't match reality.
- **Benchmark it** against a codebase you have, and report the numbers, including bad ones.
- **Improve the docs** where they assume knowledge they shouldn't.
- **Argue with `decisions.md`.** If a scope call looks wrong, open an issue and make the case.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Short version: argue about code, not people.
