# Issue #4 — auto-apply the sandbox via `PreToolUse` `updatedInput`

## Why this is a patch file, not a commit

The fix lives inside `hooks/pretooluse.mjs`, which is self-policy-protected the same way
`hooks/posttooluse.mjs` is (see `patches/issue-3-auto-apply-compression.md` for the full
explanation — same reasoning applies here).

## What's broken today

`src/guard/sandbox.ts`'s `buildSandboxCommand` (macOS Seatbelt / Linux bubblewrap) already
exists and is already applied automatically to `ledger_verify` — but only there. Every
other `Bash` call that reaches `allow` runs completely unsandboxed today; a caller has to
remember to wrap it manually. Issue #4 asks for the same automatic wrapping `ledger_verify`
gets, applied generally.

## The fix

Right before the hook's final `emit(applied.action, reason)` call, if the final decision is
genuinely `allow`, the tool is `Bash`, and `tool_input.command` is a string, the patch:

1. Detects the platform (`darwin`/`linux`/`other` — same three-way split
   `src/orchestrate/verify.ts`'s `detectPlatform` already uses).
2. Calls `buildSandboxCommand(['/bin/sh', '-c', command], platform, { workdir: process.cwd() })`.
3. Confirms the sandbox tool is actually on PATH via `sandboxToolAvailable` (Seatbelt is
   built into macOS; `bwrap` is a separate package, frequently absent on Linux — same check
   `verify.ts` already does, for the same reason: a missing wrapper fails with an immediate
   `ENOENT`, not a `null` exit code, and that must not be mistaken for the real command
   having run).
4. Shell-quotes the resulting argv into a single string (POSIX single-quote escaping,
   `'${arg.replace(/'/g, "'\\''")}'` per element) and sets it as `updatedInput.command` —
   `Bash`'s `tool_input` shape is a single command string, not an argv array, so the
   wrapped argv has to be re-flattened into something a shell will parse back into the
   exact same arguments. Verified directly (see below) — this is the part most likely to
   have a subtle bug if hand-rolled carelessly, so it was tested against a real shell, not
   just eyeballed.
5. If any step fails or returns not-ok (unsupported platform, tool absent, anything throws),
   the wrap is silently skipped and the call proceeds unsandboxed with the same
   `permissionDecision` it already had — a broken or missing sandbox must never turn an
   already-approved call into a failure.

**Only wraps a call that is actually going to run.** The check sits after the injection-cue
escalation (which can still turn an `allow` into `ask` at the last moment) and only fires
on the branch that reaches the final `emit`, so an `ask` or `deny` never gets a rewritten
command. The `bypass`-mode early-return path gets the same treatment for a different
reason: `README.md`/`CLAUDE.md` already establish that bypass relaxes only the *permission
decision* — "PostToolUse output scrubbing... stays on" — so extending that same "hygiene
isn't a permission" reasoning to auto-sandboxing under bypass is consistent with the
existing precedent, not a new policy. Worth your explicit sign-off if you'd rather that
branch NOT be sandboxed — it was a judgment call, stated here rather than made silently.

**Network is OFF by default**, no extra writable paths beyond the working directory. This
is deliberately narrow, and it's safe specifically because of *what actually reaches
`allow`* under the shipped default floor: mostly read-only git (`git status|log|diff`) —
commands that never touch the network anyway. If you've added a broader custom `allow` rule
via `ideal-harness.policy.json`, this patch will now sandbox those calls too, no-network by
default — a command that genuinely needs network will fail loudly under the sandbox rather
than silently misbehave, which is the safe failure direction, but you should know this
before applying if you've widened the default allow set.

## Kill switch

`IDEAL_HARNESS_AUTO_SANDBOX=off` disables just this new behavior. Everything else in
`pretooluse.mjs` — policy evaluation, egress-secret blocking, injection-cue escalation,
journaling — is unaffected.

## How to apply

From the repo root:

```
git apply patches/issue-4-auto-apply-sandbox.patch
```

Verified with `git apply --check` against the current `hooks/pretooluse.mjs` (2026-08-19)
— applies cleanly, no fuzz.

## How this was verified, and what's genuinely still open

Like issue #3's patch, this can't run inside `node:test` — it's a hook script invoked by
Claude Code's own runtime, and `hooks/*.mjs` isn't part of `tsconfig.test.json`'s compiled
surface. Verified as far as practical without a real Claude Code session:

1. **Syntax and existing-behavior preservation**: the patched script still correctly
   returns `permissionDecision: "allow"` for `git status` (no `updatedInput` key at all on
   a platform without sandbox support — this test ran on Windows, which
   `buildSandboxCommand` correctly reports as unsupported) and `"ask"` for `rm -rf ~/`
   (softened by the default soft floor), with output byte-identical in shape to the
   unpatched hook for every case where wrapping doesn't apply.
2. **The wrapping logic itself**: since this machine can't run the real Linux/macOS
   sandbox tools, the platform detection and tool-presence check were temporarily forced
   in a scratch copy (`detectPlatform` hardcoded to `'linux'`, the `sandboxToolAvailable`
   check bypassed) to prove the *assembly* logic — not the sandbox tools themselves —
   works. Result: a `git status` call correctly produced
   `updatedInput.command = "'bwrap' '--ro-bind' '/' '/' '--bind' '<cwd>' '<cwd>' '--dev' '/dev' '--proc' '/proc' '--unshare-net' '--' '/bin/sh' '-c' 'git status'"`
   — correct argv, correct default no-network flag, original command preserved intact.
3. **Shell-quoting round-trip, the highest-risk part**: fed a real argv containing a
   parenthesized string with spaces (a seatbelt profile) and an argument with an embedded
   single quote (`echo it's a test`) through `shellQuoteArgv`, then fed the *quoted output*
   back through a real `bash -c` and printed each resulting argument. All 6 arguments came
   back byte-identical to the originals, including the one with the embedded quote — this
   is a real proof the escaping is correct, not an assumption.

**What's genuinely NOT verified, stated plainly:**
- No real macOS or Linux machine was available in this session to run the actual
  `sandbox-exec`/`bwrap` wrapped command end-to-end and confirm the sandboxed process
  actually executes and produces the expected result (as opposed to just producing a
  correctly-shaped command string).
- The exact `updatedInput` field name and its nesting inside `hookSpecificOutput` (sibling
  to `permissionDecision`) is consistent with this project's own `README.md`/`CLAUDE.md`
  ("Auto-applying sandbox (via PreToolUse `updatedInput`)") and with Claude Code's public
  docs confirming `updatedInput` is a real, documented field name — but a live fetch of the
  full hooks reference kept truncating before reaching the PreToolUse-specific schema
  section, so the *exact* nesting and per-tool value shape (assumed here to mirror
  `tool_input`'s own shape, i.e. `{ ...input, command: <wrapped> }` for `Bash`) was not
  confirmed against a verbatim doc quote. Smoke-test this against a real Claude Code
  session in `soft` floor mode before trusting it in `enforce` mode — if the field name or
  shape is wrong, the worst case is Claude Code ignores the unrecognized field and nothing
  changes (no evidence found that a malformed hook output field causes an error rather than
  being ignored, but that itself wasn't independently confirmed either).

## Suggested follow-up (not part of this patch)

Same as issue #3: a light spawn-and-assert integration harness for `hooks/*.mjs` would let
this kind of patch be verified by `pnpm test` instead of by hand next time. Not attempted
here — out of scope for this patch.
