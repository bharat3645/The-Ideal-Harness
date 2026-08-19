# Issue #3 — auto-apply compression via `PostToolUse` `updatedToolOutput`

## Why this is a patch file, not a commit

The fix lives inside `hooks/posttooluse.mjs`. The harness's own self-policy floor
(`src/guard/policy/defaults.ts`'s `SELF_POLICY_PATTERN`) denies `Edit`/`Write` to any path
matching `hooks/(hooks\.json|[^/]+\.mjs)` — by design, so a model working inside the
harness can't quietly widen its own enforcement contract, and that protection applies to
every agent bound by the floor, not just the top-level session. So this fix was drafted,
verified as thoroughly as possible without ever writing through the protected path, and
handed off as a patch for a human to apply directly.

## What's broken today

`hooks/posttooluse.mjs` already redacts secrets and fences untrusted content via the
`updatedToolOutput` contract — but it never compresses large tool results. That's a
separate, manual step today: an agent has to remember to call the `compress` MCP tool
itself. Issue #3 asks for this to just happen automatically, the same way redaction
already does.

## The fix

After the existing `scrubToolOutput` call (redaction + injection fencing), the patch adds
one more step: run the **already-scrubbed** text through `compressToolResult` (from
`src/compress/detect.ts`, exported via `dist/compress/index.js`) — the exact same function
the `compress` MCP tool already calls manually. If it actually shrinks the content
(`method !== 'none'` — `compressToolResult` is self-gating and no-ops on anything that
wouldn't genuinely shrink), the compressed text becomes the new `updatedToolOutput`, and a
note is appended to `additionalContext` naming the method and the token delta.

**Order matters, and it's deliberate:** compression runs on `output` (the post-redaction
text), never on `raw` (the original). A secret that got redacted stays redacted through
compression — it can't reappear via, say, a JSON-array sample happening to pick the row
that held it, because by the time compression runs, that row already reads
`[REDACTED:aws-access-key]`, not the real key. Verified directly (see below).

## The one real limitation: not CCR-recoverable from this hook

This is the important part, not a footnote. `compressToolResult` is called here **without**
a `CcrStore`, on purpose. A hook script is a brand-new Node process on every single tool
call — nothing persists between invocations. A `CcrStore` created inside this hook would be
garbage-collected the instant the process exits, so the `compress` MCP server's own
`ccr_retrieve` tool (a separate, long-lived process) could never reach it. Making this
recoverable for real would mean disk-backing CCR across process boundaries, which
`decisions.md` D035 explicitly rejected ("CCR stays process-lifetime scoped, no disk
backing... an ergonomic convenience, not a durable record"). This patch doesn't reopen that
decision — it just means auto-compression via this hook is genuinely lossy (though still
token-gated, so it never makes things worse), not lossless-with-recall the way a manual
`compress` MCP tool call is. If an agent needs to pull an original back later, it should
call `compress`/`ccr_retrieve` directly instead of relying on this hook's output.

## Kill switch

`IDEAL_HARNESS_AUTO_COMPRESS=off` disables just this new behavior. Redaction and injection
fencing are unaffected — this only gates the new compression step.

## How to apply

From the repo root:

```
git apply patches/issue-3-auto-apply-compression.patch
```

Verified with `git apply --check` against the current `hooks/posttooluse.mjs` (2026-08-19)
— applies cleanly, no fuzz.

## How this was verified

Not with a unit test — `hooks/*.mjs` isn't part of `tsconfig.test.json`'s compiled test
surface, and these scripts are invoked by Claude Code's own runtime, not `node:test`. So it
was smoke-tested directly: the patched file was copied to a scratch location with its two
relative `../dist/...` imports rewritten to absolute paths (a testing artifact only — the
real patch keeps the relative imports, which resolve correctly once applied at
`hooks/posttooluse.mjs`'s real location), then run against synthetic stdin payloads
matching Claude Code's real `PostToolUse` event shape (`{tool_name, tool_input,
tool_response}`):

1. **A 500-row, ~51KB JSON array tool result** → compressed to a 5-row sample,
   `updatedToolOutput` present, `additionalContext` correctly reports
   `auto-compressed via json-array (10304 -> 122 tokens, ...)`.
2. **The same payload with `IDEAL_HARNESS_AUTO_COMPRESS=off`** → output `{}`, confirming
   the kill switch actually disables the new path.
3. **A small, incompressible payload** (`"hello world"`) → output `{}`, confirming
   `compressToolResult`'s own token gate correctly no-ops rather than "compressing" into
   something larger or equal.
4. **A 500-row array with one row's field containing a real-shaped AWS access key**
   (`AKIAABCDEFGHIJKLMNOP`) → the final `updatedToolOutput`'s sampled rows show
   `"note":"[REDACTED:aws-access-key]"`, never the raw key — direct proof the
   redact-then-compress ordering holds under the actual compression path, not just in
   theory. `additionalContext` correctly lists both warnings (the redaction one from the
   existing `scrubToolOutput` call, and the new compression one).

What this does **not** prove: a live, real Claude Code session actually invoking this hook
end-to-end and the model observing the rewritten output — that needs a human running it for
real once applied. The synthetic-stdin approach proves the script's own logic is correct
given the documented event shape; it can't prove Claude Code's runtime feeds it that exact
shape in every version, though the shape used here matches what the *existing*,
already-shipped redaction path in this same file already parses successfully in production
(`tool_name`/`tool_input`/`tool_response`, with the `toolName`/`toolInput` fallback the
original code already handles).

## Suggested follow-up (not part of this patch)

If this proves out in real use, a light integration-test harness for `hooks/*.mjs` (spawn
the script as a child process, write synthetic JSON to its stdin, assert on stdout — exactly
the smoke test above, made repeatable) would be a reasonable small addition to
`tsconfig.test.json`'s scope. Not attempted here since it's a testing-infrastructure change,
not part of issue #3's actual scope.
