# Roadmap

Every open issue, ranked by difficulty, with an honest effort estimate.

**New here?** Start with the 🟢 section. Comment on an issue to claim it — no formal
assignment process, it just stops two people building the same thing. If an issue is
unclear, say so in the issue; an unclear issue is the maintainer's bug, not your
comprehension problem.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. If you are contributing with an AI agent,
read [AGENTS.md](AGENTS.md) too.

**18 issues (#1, #2, #3, #4, #5, #7, #9, #10, #11, #12, #13, #14, #15, #16, #17, #19, #20,
#36) shipped in v0.3.0** — closed for real, with tests, not just marked done.
`CHANGELOG.md` has the detail; `decisions.md` D035–D044 has the reasoning behind each
design call.

---

## 🟢 Starter — a few hours, no need to understand the whole system

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#6](../../issues/6) | Verify Tier-2 on Cursor / Cline / Codex / Gemini | testing + docs | 2–3h |

**#6 needs no TypeScript at all** — it is real testing work, and finding something broken
is a success, not a failure. This is currently the only starter-difficulty issue open;
check back after the next backlog pass or open a new one if you find something.

## 🟡 Intermediate — half a day to two days

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#8](../../issues/8) | Reproducible public benchmark corpus | `bench`, docs | ~1d |

**#8 needs a public target**, not just code — the deliverable is a corpus + a
reproducible run against it, not a synthetic fixture.

## 🔴 Advanced — multi-day, design decisions required

Discuss the approach in the issue before writing much code. Several of these have a
dependency question attached, and this project ships **zero runtime dependencies** — so
adding one is a real decision needing a `decisions.md` entry, not an assumption.

| # | Issue | What you'll touch | Effort |
|---|---|---|---|
| [#35](../../issues/35) | Windows sandbox hardening: network egress + wiring the now-shipped process-tracking primitive through a safe stdout-relay | `guard` | multi-day |

~~#3~~, ~~#4~~, ~~#19~~, ~~#36~~ — closed 2026-08-19. #3/#4: `hooks/posttooluse.mjs` /
`hooks/pretooluse.mjs` now auto-apply compression and the OS sandbox respectively, both
with a kill switch (`IDEAL_HARNESS_AUTO_COMPRESS`/`IDEAL_HARNESS_AUTO_SANDBOX=off`).
#19: SQLite-FTS5 via Node's own built-in `node:sqlite` (zero new dependency, not even an
optional one — see `decisions.md` D041) + an honestly-labeled lexical (not neural) vector
rerank, both behind the existing episodic-store contract, degrading cleanly to the
original hand-rolled BM25 tier on Node <22.5. #36: `src/guard/vet/external.ts`'s three
real bugs (path-prefixed `check_id`, unreachable `critical` severity, `env: {}` breaking
semgrep on Windows) fixed and reverified against the real binaries.

**#35 is partially shipped.** `src/guard/sandbox.ts` now has `windowsJobObjectSupported()`
— verified-working Job Object process-tracking primitives for Windows (`CreateJobObject`/
`AssignProcessToJobObject`, no elevation, no native addon) — but `buildSandboxCommand`
still returns `ok: false` on `win32`, unchanged. Two things were tested directly and found
NOT to work: `netsh advfirewall` needs Administrator elevation, and relaying a sandboxed
child's real stdout back through a PowerShell process wrapper hit a genuine bug (two
different approaches either produced no output or hung) that risked silently degrading
`runVerify`'s stdout capture — judged worse to ship than to leave the `win32` branch at
its current, honest `ok: false`. The module doc in `src/guard/sandbox.ts` has the full
verification trail for whoever picks this up: solve the output-relay problem first, with
verification against more than a one-line string, before flipping `win32` to `ok: true`.

**How #3/#4/#36 got applied despite touching self-policy-protected paths** (`hooks/*.mjs`,
`src/guard/`): a prior session prepared ready-to-apply patches (`git apply`-verified unified
diffs plus a companion `.md` per issue, `decisions.md` D043) since the harness's own floor
denies the *model* writing there, even to itself — by design, so it can't quietly widen its
own enforcement contract. A later session, with the operator's explicit go-ahead in-thread
(same precedent as D025), reviewed, applied, rebuilt, and reverified them for real — see
`decisions.md` D044. The `patches/` directory is retired now that its contents are merged;
the full verification trail lives in `decisions.md` D043/D044 and each file's own module doc.

---

## Ways to help that need no TypeScript

All of these are real contributions and all of them are wanted:

- **[#6](../../issues/6)** — run it on a Tier-2 host and report what happens
- **[#8](../../issues/8)** — benchmarking against a public corpus
- Try the quickstart on a clean machine and note every place it does not match reality
- **Argue with `decisions.md`.** If a scope call looks wrong, open an issue and make the case. That file is the reasoning behind the architecture and it is not sacred.

## Not on the roadmap

Stated so nobody spends a weekend on something that will be declined:

- **Multi-backend runtime.** Portability is two honest tiers, not a universal abstraction — see `decisions.md` D013.
- **Bundling or downloading a browser.** The `/browse` daemon (`src/web/browse/`, shipped
  2026-08-13, `decisions.md` D034 — superseding D012's earlier fetch-only stance) depends
  on the operator's own installed Chrome/Chromium/Edge, found via `CHROME_PATH` or
  well-known per-platform paths, never downloaded or vendored. That scope boundary stays;
  the "no browser automation at all" boundary it replaced does not.
- **A hosted or managed policy service.** Team policy is a git-tracked, PR-reviewed file on purpose — D014.
- **New floor modes, profiles or environment variables.** There are already five ways to loosen the floor. New capability is welcome; new knobs almost never are.
- **A seventh module.** `core`, `guard`, `compress`, `memory`, `orchestrate`, `web` are the
  whole surface. Operational tooling that reads a module's output without changing its
  enforcement (report generation, OTel export) lives in `scripts/`, not a new module —
  see `decisions.md` D040 for the reasoning, most recently applied to #18.

---

## Current state, stated plainly

- **v0.3.0 is not yet published to npm.** The registry's latest is `0.1.0` — the package
  is behind this repo; build from source until a `v0.3.0` tag is pushed. Publishing needs
  an `NPM_TOKEN` repository secret for `release.yml`'s tag-triggered job, which is not yet
  configured — that's a repo-owner action, not something any session can do for itself.
- **6 of 9 originally-designed modules ship as real code.** `VISION.md` §7 has the full status table.
- **Tier-2 enforcement is not automatic.** Hook-driven enforcement is Claude Code-specific; on other MCP hosts the host must call the policy, sandbox and vetting CLIs itself. Stated openly rather than papered over.
- **Hook auto-application (issues #3/#4) is now live**, not just available as an MCP tool
  call — `hooks/pretooluse.mjs`/`hooks/posttooluse.mjs` apply the sandbox/compression
  automatically, each behind its own kill switch. Test this in your own session before
  relying on it in `enforce` mode, per the honest verification-gap notes in
  `decisions.md` D044.
- **Environment-conditional tests, not flaky.** `test/guard/vet-external.test.ts`'s
  semgrep/osv-scanner real-binary integration tests skip when those binaries aren't on
  PATH (true in CI) and run for real when they are (true on a dev machine with both
  installed) — see `README.md`'s Verification section for the exact counts.
