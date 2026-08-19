# Issue #35 — Windows sandbox hardening: what this patch does, and doesn't

**Scope: process-visibility research only. Not a working Windows sandbox.** Read this
before applying — the honest summary is "real, verified building blocks, not a finished
enforcement path," and the patch is written to make that impossible to miss.

## Why this is a patch file, not a direct commit

`src/guard/sandbox.ts` is self-policy-protected — the harness's own floor denies
`Edit`/`Write` to anything under `src/guard/`, including new files, so no agent working
through the harness (this one included) can commit this directly. Apply it yourself:

```
git apply patches/issue-35-windows-sandbox.patch
```

Then run `pnpm build && pnpm check && pnpm biome:fix && pnpm test` as usual.

## What's in the patch

1. `Platform` gains `'win32'` as a real member of the union (was `'darwin' | 'linux' |
   'other'`). Purely additive — nothing currently constructs `'win32'`
   (`orchestrate/verify.ts`'s `detectPlatform()` still only checks for `darwin`/`linux`
   and falls through to `'other'` for everything else, Windows included), so this changes
   no runtime behavior on its own.
2. A new exported `windowsJobObjectSupported()` function and its backing
   `JOB_OBJECT_PROBE_PS1` script. **Verified working**, directly, on a real Windows 11
   machine, as a standard (non-Administrator) user: it calls `CreateJobObject` and
   `AssignProcessToJobObject` — real Win32 process-containment primitives — through
   PowerShell's `Add-Type -TypeDefinition` (inline C#, compiled by the .NET Framework
   already on every supported Windows version). No native addon, no new dependency, no
   elevation prompt.
3. `buildSandboxCommand`'s `win32` branch — **unchanged behavior**: still returns
   `ok: false`, exactly as the current fallthrough does today. The only difference is the
   `note` field now points at `windowsJobObjectSupported()` and this file's module doc
   for anyone who goes looking for why Windows still isn't sandboxed.

## What's verified working (the useful part)

- `CreateJobObject` + `AssignProcessToJobObject`: succeeds, no elevation needed.
- `QueryInformationJobObject(JobObjectBasicProcessIdList)`: succeeds, and correctly
  reports back the exact PID that was assigned. This is a **more reliable** process-tree
  signal than `src/guard/exec.ts`'s existing `taskkill /T` tree-kill, which walks
  parent-PID links at kill time and can miss a descendant that has re-parented. A future
  patch could use this to make timeout/kill handling on Windows more accurate.

## What's verified NOT working — tested directly, not assumed

- **`netsh advfirewall firewall add rule`** (the obvious mechanism for the "network
  egress" half of this issue) — tested directly as a standard user:

  ```
  netsh advfirewall firewall add rule name="..." dir=out action=block program="..." enable=yes
  The requested operation requires elevation (Run as administrator).
  ```

  A harness that silently requires the user to run as Administrator, or silently no-ops
  the restriction, would be worse than admitting this half of the issue isn't closed. Not
  attempted further in this pass.

- **`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`** — the flag most Job Object write-ups lead
  with ("close the handle, the OS kills everything in the job"). Tested directly:
  `SetInformationJobObject` reports success, but the tracked process was **still alive**
  after the job handle was closed, repeatably, on this machine. Do not build on this flag
  without re-verifying it on the actual target OS build — it did not hold up here.

- **Relaying the sandboxed command's own stdout/stderr back through a
  PowerShell-hosted process wrapper.** This is the actual reason the working pieces
  above aren't wired into `buildSandboxCommand` yet. Two approaches were tried and both
  failed under direct, repeated testing:
  1. `Register-ObjectEvent` + `BeginOutputReadLine` (the standard async-event relay
     pattern) produced *no output at all*. Root cause: a synchronous
     `Process.WaitForExit()` call blocks the same PowerShell runspace that needs to pump
     queued events, so the event actions never fire before the script exits.
  2. A synchronous `ReadToEndAsync()` read, started *before* `WaitForExit()`
     specifically to sidestep that ordering problem, instead produced an outright hang
     for a `node -e '...'` child process in testing.
  3. Plain console-handle inheritance (no redirection at all) worked correctly for a
     trivial command (`whoami` — output round-tripped exactly) but silently produced
     *no* output for `node -e '...'` in the same test harness, while still exiting
     cleanly (code 0) — meaning the child ran and exited successfully; its output simply
     never reached wherever the parent was capturing it.

  `orchestrate/verify.ts`'s `runVerify` depends on capturing real stdout to check a
  task's `expect` pattern. A mechanism that drops output *some but not all* of the time
  would make verification quietly *less* trustworthy — exactly the property this
  project's `decisions.md` D011 ("done is a measurement, not an assertion") exists to
  protect. Shipping that regression risk to close a checkbox was judged worse than
  leaving `win32` at its current, honest `ok: false`.

## What a follow-up patch needs to do

Solve the output-relay problem *first*, with real verification against something more
demanding than a one-line string (binary output, large output that would fill a pipe
buffer, output produced after a delay) — a small compiled helper binary is one credible
path; a carefully audited synchronous stream-copy loop with byte-level verification is
another. Only once that's solid should `buildSandboxCommand`'s `win32` branch actually
start returning `ok: true`. At that point, filesystem write restriction (this patch does
not attempt it at all) and a real answer for network egress (elevation, or a native
Windows Filtering Platform binding this project's zero-dependency architecture doesn't
currently support) are the two pieces still needed to satisfy issue #35's full
acceptance criteria.

## How this was verified

- `windowsJobObjectSupported()`'s exact backing script was extracted from the patched
  source and run for real via `spawnSync('powershell.exe', ...)` on this machine:
  `status: 0`, `stdout: "CREATE_OK\r\n"` — matches what the function checks for.
- The patch applies cleanly: `git apply --check patches/issue-35-windows-sandbox.patch`
  exits 0 against the current `src/guard/sandbox.ts`.
- The patched file type-checks cleanly under the project's actual strict compiler
  settings (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc. from
  `tsconfig.base.json`), verified via a standalone `tsc` run against a scratch copy.
- The three "verified NOT working" findings above were each reproduced multiple times,
  not observed once and assumed general.

No `test/guard/sandbox.test.ts` changes are included — the new function is exercised by
the verification above, but a durable, CI-safe test would need to skip on non-Windows
runners (matching this project's existing `t.skip()`-on-absence convention for
platform/binary-gated tests) and was left for whoever picks up the follow-up patch,
since it wasn't clear this session should design that test without also deciding how
`windowsJobObjectSupported()`'s eventual real caller will be tested.
