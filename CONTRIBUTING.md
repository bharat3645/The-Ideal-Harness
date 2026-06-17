# Contributing to The Ideal Harness

Thanks for wanting to make the harness better. A few principles keep this codebase
coherent — they are not negotiable, because they are the whole point.

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
pnpm build      # turbo, dependency-ordered
pnpm check      # type-check (strict, exactOptionalPropertyTypes)
pnpm test       # node:test, zero test-framework deps
pnpm biome:fix  # lint + format (single quotes, 2-space, 120col)
```

A change is not done until `pnpm build && pnpm check && pnpm test && pnpm biome` are all
green, `node packages/core/dist/cli/index.js validate .` passes, and every `SKILL.md` you
touched passes `node packages/guard/dist/cli/index.js vet <file>`.

## Adding a module

Each package follows the same shape: a `package.json` (depends on `@ideal-harness/core`),
`tsconfig.json` + `tsconfig.test.json`, `.claude-plugin/plugin.json`, `src/` with a clean
public `index.ts`, and three faces where it makes sense — a Claude Code plugin (skills /
hooks), a standalone MCP server (`src/runtime/mcp.ts`, built on `createMcpServer` from
core), and a CLI (`src/cli/index.ts`). Register the plugin in `.claude-plugin/marketplace.json`.

## Code style

- `function` keyword for top-level functions; explicit return types on exports.
- `Result<T,E>` over throwing for fallible operations.
- Early returns and guard clauses over deep nesting; no nested ternaries.
- Comments are timeless: explain the non-obvious *why*, never the edit history.

## Commits

Small, focused commits with a clear message. Branch off `main`; open a PR. CI must be green.
