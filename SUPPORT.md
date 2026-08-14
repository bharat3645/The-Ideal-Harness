# Support

Where to ask what, and what to expect back.

## Where to go

| You want to | Go here |
|---|---|
| Report something behaving differently from the docs | [Open a bug](../../issues/new?template=bug_report.yml) |
| Propose a capability | [Open a proposal](../../issues/new?template=feature_request.yml) — read `DESIGN.md` §6 and `decisions.md` first |
| Find something to work on | [ROADMAP.md](ROADMAP.md) — every issue ranked by difficulty |
| Understand why something is built the way it is | [`decisions.md`](decisions.md) — the answer is usually already there, recorded at the time |
| Report a security vulnerability | [SECURITY.md](SECURITY.md) — **not** a public issue |
| Ask a general question | [Discussions](../../discussions) |

## Before you open an issue

Two minutes that will usually save you longer:

1. **`ideal-harness doctor`** — one command, exits non-zero on any wiring problem. It checks that `dist` is built, hooks are wired, all five MCP servers boot and answer `initialize`, the policy file parses, and the journal directory is writable. Most "it doesn't work" reports turn out to be one of those.
2. **Build from source.** The published npm package is behind this repo — see the publish-freshness note in the README. If you installed via `npx`, you are running old code and the docs will not match.
3. **Check `decisions.md`.** If your question is "why isn't this done the obvious way," the reasoning is probably recorded there with the alternatives that lost.

## What to expect

This is maintained by one person alongside a full-time job. Realistically:

- **Issues:** a first response within a few days. Faster if it is a clear bug with a reproduction.
- **Pull requests:** reviewed within a week. Small, focused PRs move faster — a diff doing four unrelated things cannot be meaningfully reviewed.
- **Security reports:** prioritised over everything else.
- **Feature proposals:** may sit while I think. A slow reply is not a no; silence past a couple of weeks means ping me.

If something is genuinely blocking you, say so in the issue. It changes the priority.

## What is in scope

**Yes:** bugs, docs that do not match reality, portability problems on supported hosts, security issues, and the roadmap items in [ROADMAP.md](ROADMAP.md).

**Probably not:** new floor modes, profiles or environment variables. There are already five distinct ways to loosen the floor, and the decision layer stays minimal on purpose. New *capability* is welcome; new *knobs* almost never are.

**Explicitly not**, with the reasoning recorded in `decisions.md`: a multi-backend runtime (D013), browser automation in `web` (D012), a hosted policy service (D014).

## Commercial use

MIT licensed — use it in commercial products, no permission needed and no attribution required beyond the licence.

If you are running this in production and need something specific — a capability on the roadmap moved forward, or help with an integration — open an issue and say so. Knowing something is blocking real usage genuinely changes what gets built next.
