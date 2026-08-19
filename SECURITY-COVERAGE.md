# OWASP Agentic AI Top 10 (2026) — coverage

`SECURITY.md` states alignment with OWASP LLM06 (Excessive Agency) in passing. That's one
item out of ten in the current framework, and it undersells what `guard` actually does.
This document maps all ten items of the **OWASP Top 10 for Agentic Applications, 2026
edition** (ASI01–ASI10, published by the OWASP GenAI Security Project, 2025-12-09) against
what's actually shipped in this repo, with a file path behind every claim.

**Tally: 1 full, 8 partial, 1 out of scope.** No item is claimed "full" without a specific
mechanism behind it, and no gap is hidden. A table claiming 10/10 would be checked against
the source in about the same time it took to write this one — Microsoft's Agent Governance
Toolkit already makes that exact claim, backed by a seven-package enterprise product; this
project's honesty is the actual differentiator, not a bigger number. See the competitive
research this table grew out of (`ROADMAP.md` #20) for that comparison.

Verdicts are **full** (a specific, shipped mechanism addresses the risk with no known
material gap), **partial** (real coverage exists; a specific, named gap remains), or
**out of scope** (nothing addresses it, and that's an architectural fact of this project's
design, not an oversight).

---

## ASI01 — Agent Goal Hijack

*Attackers alter agent objectives through malicious content the agent retrieves, not user
inputs.*

**Verdict: Partial.**

`src/guard/injection.ts` (`looksLikeInjection`) scans every tool result for injection cues
and, via `src/guard/scrub.ts`'s `scrubToolOutput`, wraps flagged or inherently-external
content (`WebFetch`, `WebSearch`, any `mcp__*` tool, or anything tripping a cue) in a
breakout-safe `<untrusted_content>` fence before the model reads it — enforced automatically
on every `PostToolUse` call via `hooks/posttooluse.mjs`, confirmed live in this session
(`WARNING: tool output contains prompt-injection cues — fenced as untrusted data`). This is
real, automatic, below-the-model defense against exactly the mechanism ASI01 describes.

**The gap:** `INJECTION_CUES` is a fixed list of regex patterns (`ignore all previous
instructions`, `reveal your system prompt`, etc.). A goal-hijack attempt phrased outside
those patterns — the actual threat model, since a competent attacker doesn't reuse the
canonical demo phrasing — is not detected by this layer. There is no semantic or
model-based classifier behind it; it is a deliberately cheap, deterministic heuristic; that
tradeoff is inherent to keeping the floor dependency-free and auditable, not a bug.

## ASI02 — Tool Misuse and Exploitation

*Agents misuse legitimate tools in unsafe ways, chaining them in unintended sequences.*

**Verdict: Partial.**

Every individual tool call is gated by the deny-wins tiered policy engine
(`src/guard/policy/defaults.ts`, `evaluateTiered`) — credential reads and destructive shell
are denied outright, `Bash`/`Edit`/`Write`/`WebFetch` require approval by default, and
outbound calls are additionally scanned for embedded secrets before they run
(`hooks/pretooluse.mjs`'s `EGRESS_TOOLS` check). This bounds what any single call can do,
which is most of ASI02's surface.

**The gap:** there is no cross-call sequence analysis. A chain of individually-permitted
calls that together accomplish something none of them would individually (e.g. reading a
file, then a separate approved network call that exfiltrates a summary of it) is not
detected as a pattern — each call is judged in isolation. `src/orchestrate/loopguard.ts`'s
`LoopGuard` catches a *stalled, repeating* agent, which is an adjacent but different failure
mode (no-progress, not malicious-sequence).

## ASI03 — Identity and Privilege Abuse

*Agents operate with excessive permissions through shared credentials or inherited user
sessions.*

**Verdict: Full**, within this project's single-operator architecture.

`src/guard/leases.ts`'s capability leases are the core mechanism: narrow, human-granted,
time- and/or call-count-bounded elevated allows that auto-expire — "grant Bash matching X
for the next 30 minutes" rather than a standing broad allow. Grant/revoke are **CLI-only,
never an MCP tool** (`decisions.md` D016) specifically so the model cannot elevate its own
privilege. `src/guard/secrets.ts`'s `SecretsBroker` is the positive-path complement:
scoped, named-secret access with an audit log, the inverse of redaction. Leases sit as the
highest-precedence policy tier (`src/guard/resolve.ts`'s `resolveOperatorTiers`), and the
self-policy deny pattern (`defaults.ts`'s `SELF_POLICY_PATTERN`) stops the model from
editing `leases.json` directly.

**Scope note, not a gap:** this project has one operator and one model — there's no
multi-user identity system to abuse in the first place. "Full" here means the
least-privilege/no-self-escalation property is real and enforced, not that a multi-tenant
identity model was built and secured (none exists, by design).

## ASI04 — Agentic Supply Chain Vulnerabilities

*Compromised dependencies in frameworks, models, and tool integrations enable code
execution.*

**Verdict: Full** — real mechanism, no known material gap.

Two independent mechanisms, not one:

1. **Zero runtime dependencies is a defended architectural stance** (`decisions.md` D007,
   `package.json` has no `dependencies` key, enforced by convention and CI). This is the
   single largest supply-chain attack surface most agent frameworks carry — a compromised
   transitive dependency — and this project doesn't have one to compromise. `web-tree-sitter`
   is the one opt-in exception, a devDependency loaded via dynamic import behind a try/catch,
   degrading to the regex tier on absence or failure.
2. **Third-party skill vetting** (`src/guard/vet/`): `scanSkill` runs a threat-signature
   database (`patterns.ts`) plus homoglyph/hidden-character detection (`homoglyph.ts`)
   against any skill before it's trusted; `vet_skill_deep` additionally shells out to
   `semgrep` (offline, bundled ruleset) and `osv-scanner` (`external.ts`'s `runOsvScanner` —
   literally a dependency-vulnerability scanner) when present on PATH, degrading to
   `available: false` rather than failing hard when absent. This directly targets exactly
   the risk this ASI item names for anything installed *into* the harness.

**A gap was found by this project's own testing, not hidden — and is now fixed.**
`ROADMAP.md` #7 shipped real integration tests against the actual `semgrep`/`osv-scanner`
binaries (previously exercised only via their absence path) — and they immediately found
real bugs in the parsers reading those binaries' output, tracked as **issue #36**. The one
that mattered for this item's verdict: `parseOsvOutput`'s severity classification did a
substring match for the literal word `"critical"`, but real `osv-scanner` output encodes
severity as a CVSS vector string (e.g. `CVSS:3.1/AV:N/...`) that never contains that word —
so a genuinely critical dependency vulnerability could never be classified above `'high'`
by this mechanism. (A second bug — `parseSemgrepOutput`'s `check_id` was path-prefixed
rather than the bare rule id — was a tracking/leakage defect, not a detection-fidelity one.)
Both bugs lived in `src/guard/vet/external.ts`, which is self-policy-protected — the
session that found them could document them precisely with failing tests but not fix them
directly, so a ready-to-apply patch was prepared instead. That patch has since been applied
with explicit operator go-ahead and reverified against the real binaries (`decisions.md`
D043/D044): `parseOsvOutput` now computes a real CVSS 3.1 Base Score and correctly reaches
`critical`, and `check_id` is reduced to the bare rule id. Per this document's own
definition of "full" ("no known material gap"), with the confirmed gap closed and
reverified — not just claimed fixed — the verdict returns to "Full."

## ASI05 — Unexpected Code Execution

*Natural language execution boundaries are breached, allowing arbitrary command execution
through agent manipulation.*

**Verdict: Partial**, with a named, tracked, platform-specific gap.

`src/guard/sandbox.ts`'s `buildSandboxCommand` wraps a command in Seatbelt (macOS) or
bubblewrap (Linux) before it runs, restricting filesystem writes and (by default) network
access; `src/guard/exec.ts` handles process-tree-safe termination on timeout so a runaway
child can't outlive its sandbox. `src/orchestrate/verify.ts`'s `runVerify` — the mechanism
behind `ledger_verify` — applies this automatically wherever the platform supports it.

**The gap, confirmed in source and already tracked:** on Windows, `buildSandboxCommand`
returns `{ ok: false, note: 'no OS sandbox available on this platform' }` — there is no
enforcement path there. This was a deliberate, documented tradeoff at the time
(`decisions.md` D011: "an always-sandboxed requirement — rejected — Windows/other platforms
have no OS sandbox, and refusing to verify there defeats the point on most real dev
machines"), and the current behavior is to run **unsandboxed with honest reporting**
(`sandboxed: false`) rather than either silently claiming protection or refusing to run at
all. As of this document, a competing project (DeepSeek Harness) ships a working Windows
ACL enforcement path that this project doesn't — see **issue #35** ("Sandbox hardening:
close the Windows gap in `guard`'s sandbox"), opened specifically to close this. Partial
progress landed 2026-08-19: `windowsJobObjectSupported()` in `src/guard/sandbox.ts` is a
verified-working Windows process-tracking primitive (Job Objects, no elevation needed), but
`buildSandboxCommand` still returns `ok: false` on `win32` — the primitive isn't wired into
the enforcement path yet, on purpose, because doing so safely first needs a real fix for a
confirmed stdout-relay bug (see the module's own doc comment and `decisions.md` D043). The
verdict here stays "Partial" until that's closed.

## ASI06 — Memory and Context Poisoning

*Attackers implant false information into persistent memory that persists across future
sessions.*

**Verdict: Partial.**

`src/memory/curator.ts`'s `reconcileClaims` is the direct mechanism: before an LLM's
self-reported "what I did" is committed to the episodic store, its claims are checked
against real tool-call evidence via token overlap, and a claim below the overlap threshold
is marked `evidenced: false` rather than trusted outright. This is specifically designed to
stop a model's own prose from becoming unverified "fact" in memory — one real vector for
context poisoning. Workspace isolation (`src/memory/workspace.ts`) additionally stops
cross-project memory leakage, so poisoned memory in one project can't bleed into another.

**The gap:** the curator checks *the model's own claims* against evidence — it does not
independently validate the *content of tool results themselves* before they become evidence
(e.g. a web page's text, once fetched, is trusted as "what happened" if a later claim
references it, even though `ASI01`'s injection-fencing already flags known injection
patterns in that same content). There's also no anomaly detection over the episodic store
itself (a burst of similar false observations landing in one session isn't specifically
flagged as suspicious) — this remains open regardless of #19's retrieval-quality
improvements (D041, closed 2026-08-19): a sharper *ranking* of episodic recall does not add
*anomaly detection* over what's stored, which is what this specific gap is about.

## ASI07 — Insecure Inter-Agent Communication

*Unauthenticated messages between agents enable attackers controlling one agent to
manipulate others.*

**Verdict: Out of scope**, and this is architectural rather than a gap to close.

This project has no inter-agent wire protocol of its own. Subagent dispatch
(`agents/scout.md`, `agents/implementer.md`, `agents/reviewer.md`, `agents/plan-critic.md`)
happens entirely through Claude Code's own native subagent mechanism — context handoff, not
a message bus this project defines, authenticates, or could compromise independently of
Claude Code itself. There is no fleet of independently-addressable agents passing signed or
unsigned messages to each other that `guard` would need to authenticate.

**Adjacent, not equivalent, and now closed:** `ROADMAP.md` #17 ("no concurrency control on
any persisted state — two sessions silently clobber each other") was a real bug about
*concurrent sessions racing on shared files* (the ledger, the journal, the memory graph) — a
data-integrity problem, not spoofed/replayed/unauthenticated inter-agent messaging. It
shipped a fix (`src/core/runtime/lock.ts`, `decisions.md` D039) and is no longer open. Noted
here only because the two risks sound adjacent enough to be worth distinguishing, not
because either is still a live gap for this item.

## ASI08 — Cascading Failures

*Single security failures in one agent propagate through connected systems with escalating
impact.*

**Verdict: Partial.**

Three mechanisms bound blast radius within a single project's session, in different ways:
`src/orchestrate/loopguard.ts`'s `LoopGuard` detects a stalled/repeating agent (3 identical
actions in a row by default) so a controller can break the loop before it burns unbounded
budget; `src/orchestrate/spend.ts`'s `SpendGovernor` hard-caps token/cost spend and blocks
further work once exceeded; `src/orchestrate/worktree.ts`'s fanned-out worktrees
(`.ideal-harness/worktrees/<id>`) isolate concurrent implementer tasks from each other's
filesystem state so one task's failure doesn't corrupt a sibling's.

**The gap:** none of these three mechanisms addresses failure propagating *between*
separate projects/sessions — each is scoped to bounding one session's own runaway behavior,
not a distributed cascade across systems this project doesn't control. (The one
mechanism-specific gap that used to sit here — `SpendGovernor` losing its counter on every
MCP server restart, so a cap didn't survive the exact crash/restart scenario where it would
matter most — is closed: spend state now persists to disk and restores fail-closed on
corrupt/missing state, `ROADMAP.md` #14, `decisions.md` D037.)

## ASI09 — Human-Agent Trust Exploitation

*Agents manipulate humans into approving harmful actions through persuasive, confident
communication.*

**Verdict: Partial.**

The floor's permission decisions are computed from the actual tool name and arguments via
fixed regex rules (`src/guard/policy/defaults.ts`), never from the model's own framing or
justification of the call. A `Bash` call running `rm -rf ~/` is classified
`deny-destructive-bash` regardless of how persuasively the model explains why it's safe —
the model's prose has no path to reclassify the decision. Every non-allow decision also
carries an explicit, uniform reason string naming the exact rule and the operator knobs
that could change it (`pretooluse.mjs`'s explain-mode), so what a human is being asked to
approve is stated by the floor, not paraphrased by the agent asking.

**The gap:** this defends the *classification* of a request, not the human's judgment once
an `ask` is actually presented. Nothing in this project detects or flags an unusually
persuasive or urgency-laden framing in the model's own surrounding text — a human can still
be talked into approving something the floor correctly labeled `ask` rather than `deny`
(soft mode, the default, downgrades every deny to an ask for exactly this reason: a human
decides). That's a deliberate design choice (`decisions.md` D005), not an oversight, but it
does mean ASI09's specific "confident language exploits human trust" mechanism isn't
directly countered once a request reaches the human.

## ASI10 — Rogue Agents

*Agents exhibit misalignment and self-directed behavior pursuing unintended, unsanctioned
goals.*

**Verdict: Partial**, and this is the item where the framing of "coverage" matters most.

`SECURITY.md`'s own stated threat model is built around exactly this risk: "the model is
not trusted to police itself. Every safety rule is deterministic code, not a prompt
instruction." The entire floor — deny-wins policy, OS sandboxing, always-on secret
redaction, human-only capability leases, the hash-chained audit journal
(`src/guard/journal.ts`) — exists to bound what a rogue or misaligned agent **can actually
do**, independent of what it intends. This is real, substantial, and is this project's core
thesis, not an afterthought.

**The gap, stated precisely:** none of this *detects* rogue behavior — there is no
goal-drift monitor, no anomaly detection over an agent's own action sequence, no mechanism
that flags "this session's behavior looks different from its stated task." The floor is
purely a capability boundary: it makes a rogue agent's actions visible (the journal), gated
(the policy), and contained (the sandbox, where the platform supports it), but it does not
notice rogueness on its own. Given this project's explicit position that the model is never
trusted to self-police, that's arguably the correct division of labor — detection is a
human/observability concern (`scripts/report.mjs` renders the journal for a human to review)
rather than something the floor itself claims to do — but it means "containment" and
"detection" should not be conflated when reading this verdict.

---

## Summary table

| # | Item | Verdict | Primary mechanism |
|---|---|---|---|
| ASI01 | Agent Goal Hijack | Partial | `src/guard/injection.ts`, `scrub.ts` |
| ASI02 | Tool Misuse and Exploitation | Partial | `src/guard/policy/defaults.ts` |
| ASI03 | Identity and Privilege Abuse | Full (single-operator scope) | `src/guard/leases.ts`, `secrets.ts` |
| ASI04 | Agentic Supply Chain Vulnerabilities | Full | zero-dep architecture + `src/guard/vet/` |
| ASI05 | Unexpected Code Execution | Partial — Windows gap tracked (#35), process-tracking primitive shipped but not wired in | `src/guard/sandbox.ts`, `exec.ts` |
| ASI06 | Memory and Context Poisoning | Partial | `src/memory/curator.ts` |
| ASI07 | Insecure Inter-Agent Communication | Out of scope (architectural) | n/a — no inter-agent protocol exists |
| ASI08 | Cascading Failures | Partial — no cross-session cascade containment | `loopguard.ts`, `spend.ts`, `worktree.ts` |
| ASI09 | Human-Agent Trust Exploitation | Partial | deterministic classification, explain-mode |
| ASI10 | Rogue Agents | Partial | the entire floor (containment, not detection) |

Cross-referenced open work: issue #35 (Windows sandbox parity — partially shipped, see
ASI05 above; the process-tracking primitive is real, the enforcement wiring is not).
#7, #14, #15, #17, #19, and #36 — all cited in earlier drafts of this table as open gaps —
have since shipped and are closed; this table was revised 2026-08-19 to stop citing them as
open. Cross-referenced decisions: `decisions.md` D005 (soft floor by default), D007 (zero
deps), D011 (sandboxed verification, Windows tradeoff), D016 (leases CLI-only), D037 (spend
durability), D039 (concurrency locking), D041 (episodic FTS5 + lexical vector rerank), D043/
D044 (the four self-policy-blocked patches, prepared then applied).

*Compiled 2026-08-19 against OWASP's Agentic Applications Top 10, 2026 edition
(ASI01–ASI10, published 2025-12-09 by the OWASP GenAI Security Project). Re-verify against
the framework's canonical source before citing this document as current — the framework is
new enough that secondary summaries (including the ones used to compile this table) can
drift from the primary text.*
