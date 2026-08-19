# Issue #36 — `vet_skill_deep` parser bugs, patch notes

Three confirmed bugs in `src/guard/vet/external.ts`, found by issue #7's real
semgrep/osv-scanner integration tests. Not fixed directly in this repo because
`src/guard/**` is self-policy-protected — the harness's own floor denies
`Edit`/`Write` there, including to an agent working within that same floor.
The fix lives in `patches/issue-36-vet-external-bugs.patch` instead.

## What's broken

1. **`parseSemgrepOutput`'s finding `id` is semgrep's raw, path-prefixed
   `check_id`, not the bare rule id.** `runSemgrep` always points `--config`
   at a rules file it writes itself (to stay fully offline). When `--config`
   is a local file, real semgrep doesn't return the bare id from the YAML —
   it dot-joins the config's own absolute path and appends the id. Verified
   directly against real semgrep 1.173.0: a finding for the bundled
   `sg-js-eval` rule comes back as `check_id: "C.Users.<...>.ih-semgrep-XXXXXX.
   sg-js-eval"`, not `"sg-js-eval"`. Two consequences: matching a finding by
   its stable rule id never works, and the id leaks a local temp-directory
   path into data that might be logged or displayed.

   (One correction made while re-verifying this patch: the original bug
   report guessed the path prefix always ended in a literal `.rules.` segment
   matching the rules file's own name. Running the real binary again showed
   that's not what semgrep actually emits — there's no `.rules.` segment at
   all, just the dotted directory path directly followed by the rule id. The
   fix strips everything up to the *last* dot instead of looking for a
   specific delimiter, which is correct either way since none of this
   project's rule ids contain a dot.)

2. **`parseOsvOutput`'s severity can never reach `'critical'`.** The old code
   decided `critical` via `/critical/i.test(JSON.stringify(vuln.severity))`.
   Real osv-scanner's `severity` field is an array of CVSS vector strings
   (e.g. `[{"type":"CVSS_V3","score":"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}]`)
   — the literal word "critical" never appears in that shape, for any
   finding, regardless of actual severity. Every real finding was therefore
   always classified `'high'`.

3. **Both exec call sites passed `env: {}` to the child process.** Confirmed
   directly: `binaryAvailable('semgrep', ...)` intermittently reports
   `available: false` with an empty environment on this machine, even though
   `semgrep --version` succeeds reliably (~3.3s) with a normal environment —
   an empty env breaks semgrep's Windows Python entry point. `osv-scanner`, a
   static Go binary, tolerates `env: {}` fine, which is why this went
   unnoticed until the check_id/severity bugs forced a closer look.

## The fix

- **check_id**: new `bareRuleId(checkId)` strips everything up to and
  including the *last* `.` in the string. Since none of this project's own
  `SEMGREP_RULES` ids contain a dot, the bare id is always the final
  dot-separated segment, however many path segments precede it. A check_id
  that never went through the path-prefixing (e.g. the exec-faked tests'
  synthetic stdout, which has no dots at all) passes through unchanged.
- **severity**: a real CVSS 3.1 Base Score calculator (`parseCvss3BaseScore`,
  following the official spec's §7.4 formula and §5 rating table exactly,
  including the spec's own floating-point-safe "round up to one decimal"
  algorithm) computes a numeric score from the vector string, then classifies
  it (`≥9.0` critical, `≥7.0` high, `≥4.0` medium, else low). Falls back to
  osv's own `database_specific.severity` string when no parseable CVSS
  vector is present (some ecosystems/advisories omit CVSS entirely), and
  falls back to `'high'` only if neither is available — a known vulnerability
  is never silently under-reported as `'low'` just because it couldn't be
  scored.
- **env**: new `childEnv()` returns `scrubEnv(process.env)` — the same
  secret-stripping allowlist-by-exclusion helper `src/guard/sandbox.ts`
  already uses for every other shelled-out command — instead of `{}`, at
  both `binaryAvailable` and the two real scan invocations.

## How to apply

```
git apply patches/issue-36-vet-external-bugs.patch
```

from the repo root. Verified with `git apply --check` against the current
`src/guard/vet/external.ts` — applies cleanly.

## Verification performed

Could not run `pnpm test`/`pnpm build` against the real repo tree directly
(same self-policy restriction — the compiled `dist/guard/**` the fix would
need to land in is protected too). Instead:

- **Typechecked in isolation**: copied `src/guard/**` into a scratch
  directory, swapped in the fixed `external.ts`, and ran `tsc --noEmit`
  against this repo's real `tsconfig.base.json` flags (`strict`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc.) — clean,
  exit 0.
- **Ran for real against semgrep 1.173.0 and osv-scanner 1.9.2**, both
  genuinely installed on this machine. `runSemgrep` against a file containing
  `eval(userInput)` now returns `findings[0].id === 'sg-js-eval'` exactly.
  `runOsvScanner` against a `package-lock.json` pinning `lodash@4.17.15`
  returns 6 real advisories; every one's computed severity (3× `medium`, 3×
  `high`) exactly matches osv-scanner's own curated
  `database_specific.severity` rating for that finding (cross-checked
  independently, not just internally consistent).
- **Cross-checked two of the six by hand** against the CVSS 3.1 formula:
  `GHSA-35jh-r3h4-6jhm` (`AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H`) computes to
  7.2 → `high`; `GHSA-r5fr-rjxr-66jc` (`AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H`)
  computes to 8.1 → `high`. Both match osv-scanner's own `HIGH` rating.

## Tests: which ones flip, and one that needed its own fixture fixed

Two tests in `test/guard/vet-external.test.ts` exist specifically to
*document* these bugs — they assert the buggy behavior on purpose, as this
project's honesty rule requires ("say what's broken," not "make the suite
green by any means"). Once the source patch lands, those exact assertions
invert:

- `runSemgrep: real binary flags a genuine eval() finding — BUG: check_id is
  path-prefixed, not the bare rule id` — currently asserts
  `result.findings[0]?.id !== 'sg-js-eval'` (documents the bug). After the
  patch, `id` really is `'sg-js-eval'`, so this specific assertion starts
  failing — not a regression, the inverse of what it was built to prove.
- `runOsvScanner: real binary flags a genuine known-vulnerable lodash — BUG:
  severity is always "high", never "critical"` — currently asserts
  `result.findings.every(f => f.severity !== 'critical')`. This one still
  technically holds after the patch (none of lodash 4.17.15's *specific*
  advisories happen to be CVSS-critical — see the hand-checked scores above),
  so it wouldn't actually fail, but its assertion and comment become
  misleading (it reads as "critical is unreachable," which is no longer
  true in general, just not exercised by this particular fixture).

A third, unrelated test also needs its fixture updated once the patch lands:
`runOsvScanner parses a present tool's JSON findings when exec is faked as
available` supplies `severity: [{ type: 'CVSS_V3', score: '9.8 CRITICAL' }]`
— a plain string, not a real CVSS vector. The *old* buggy code passed this
by luck (its substring match caught the literal word "CRITICAL"). The fixed
CVSS parser correctly does not recognize `'9.8 CRITICAL'` as a vector (it
doesn't match `CVSS:3.x/...`), so this fake test would start failing too —
again, not a regression, proof the fix stopped taking the same shortcut. This
exact unrealistic shape was already flagged in the pre-patch code's own bug
comment as something "real osv-scanner never actually produces."

All three are addressed by the same follow-up diff, shown in full below
rather than as a second `.patch` file (a `patches/issue-36-test-assertions.patch`
write was attempted and denied in this session — `test/` is not
self-policy-protected, so this is safe to apply by hand, or ask for the
`.patch` file again in a fresh session if you'd rather `git apply` it):

```diff
--- a/test/guard/vet-external.test.ts
+++ b/test/guard/vet-external.test.ts
@@ -116,7 +116,11 @@
                 {
                   id: 'GHSA-test-0000',
                   summary: 'a known vulnerability',
-                  severity: [{ type: 'CVSS_V3', score: '9.8 CRITICAL' }],
+                  // A real CVSS 3.1 vector (issue #36 fix) -- not the plain string
+                  // '9.8 CRITICAL' the old fake fixture used, which real osv-scanner
+                  // never actually produces (see the fix's comment in external.ts).
+                  // This exact vector computes to a 9.8 base score, i.e. 'critical'.
+                  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
                 },
               ],
             },
@@ -228,7 +232,7 @@
 const semgrepAvailable = binaryOnPath('semgrep');
 const osvScannerAvailable = binaryOnPath('osv-scanner');

-test('runSemgrep: real binary flags a genuine eval() finding — BUG: check_id is path-prefixed, not the bare rule id', async (t) => {
+test('runSemgrep: real binary flags a genuine eval() finding with the bare rule id (issue #36, fixed)', async (t) => {
   if (!semgrepAvailable) {
     t.skip('semgrep not on PATH in this environment');
     return;
@@ -245,29 +249,19 @@
     assert.equal(result.findings[0]?.category, 'semgrep');
     assert.equal(result.findings[0]?.severity, 'high'); // ERROR -> high: this half of the mapping is correct.

-    // CONFIRMED BUG (not fixed here — src/guard/vet/external.ts is self-policy-protected):
-    // `parseSemgrepOutput` uses semgrep's raw `check_id` verbatim as the finding's `id`.
-    // When `--config` points at a LOCAL FILE (as `runSemgrep` always does — it writes its
-    // own rules file to a tmp dir, by design, to stay fully offline), real semgrep does
-    // NOT return the bare rule id from the YAML (e.g. "sg-js-eval"). It synthesizes a
-    // check_id by prefixing the rule id with the rules file's own path, normalized to
-    // dots — observed real output: a check_id like
-    // "C.Users.<...>.ih-semgrep-XXXXXX.rules.sg-js-eval", NOT "sg-js-eval".
-    // Two concrete consequences: (1) any code expecting to match a finding by its stable
-    // rule id (e.g. "sg-js-eval") against real output will never match — only the
-    // execFn-faked tests above pass, because the fakes hand back the bare id directly;
-    // (2) the finding's `id` field leaks the full local temp-directory path of the
-    // process that ran the scan into data that could be logged, displayed, or compared.
-    // This assertion documents the REAL (buggy) shape rather than the intended one:
-    assert.notEqual(
+    // FIXED (issue #36, patches/issue-36-vet-external-bugs.patch): real semgrep does
+    // NOT return the bare rule id in `check_id` when `--config` points at a LOCAL FILE
+    // (as `runSemgrep` always does — it writes its own rules file to a tmp dir, by
+    // design, to stay fully offline). It dot-joins the config's own absolute path and
+    // appends the rule id — real observed output: "C.Users.<...>.ih-semgrep-XXXXXX.
+    // sg-js-eval", not "sg-js-eval". `bareRuleId()` strips everything up to and
+    // including the final dot to recover it. This used to be asserted as a documented
+    // bug (the id was left path-prefixed, leaking a local temp path into data that
+    // could be logged or displayed); now the fix is asserted directly:
+    assert.equal(
       result.findings[0]?.id,
       'sg-js-eval',
-      'documents the bug: real semgrep does NOT return the bare rule id here (see comment above) — if this assertion ever starts failing, the bug has been fixed upstream or in this codebase, not a regression',
-    );
-    assert.match(
-      result.findings[0]?.id ?? '',
-      /sg-js-eval$/,
-      'the bare rule id is still present as a SUFFIX of the real check_id, just path-prefixed',
+      'check_id should now be reduced to the bare rule id, not left path-prefixed',
     );
   });
 });
@@ -286,7 +280,7 @@
   });
 });

-test('runOsvScanner: real binary flags a genuine known-vulnerable lodash — BUG: severity is always "high", never "critical"', async (t) => {
+test('runOsvScanner: real binary flags a genuine known-vulnerable lodash with a differentiated CVSS-based severity (issue #36, fixed)', async (t) => {
   if (!osvScannerAvailable) {
     t.skip('osv-scanner not on PATH in this environment');
     return;
@@ -316,22 +310,27 @@
     assert.ok(result.findings.length > 0, 'lodash 4.17.15 has multiple known advisories (e.g. GHSA-29mw-wpgm-hmr9)');
     assert.match(result.findings[0]?.evidence ?? '', /lodash@4\.17\.15/);

-    // CONFIRMED BUG (not fixed here — src/guard/vet/external.ts is self-policy-protected):
-    // `parseOsvOutput` decides `critical` via `/critical/i.test(JSON.stringify(vuln.severity))`.
-    // Real osv-scanner does NOT put the word "critical" anywhere in `vulnerabilities[].severity`
+    // FIXED (issue #36, patches/issue-36-vet-external-bugs.patch): `parseOsvOutput` used
+    // to decide `critical` via `/critical/i.test(JSON.stringify(vuln.severity))`, but real
+    // osv-scanner never puts the word "critical" anywhere in `vulnerabilities[].severity`
     // — that field is an ARRAY OF CVSS VECTOR STRINGS, e.g.
-    // `[{"type":"CVSS_V3","score":"CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H"}]`. The literal
-    // substring "critical" never appears in that format for ANY finding, no matter how severe
-    // the actual CVSS score is (a 9.8/CRITICAL-rated CVE and a 3.1/LOW one are indistinguishable
-    // to this code). Every real finding is therefore always classified as `severity: 'high'`,
-    // never `'critical'` — the fake-exec test earlier in this file passes only because its
-    // fake stdout invents an unrealistic shape (`"score": "9.8 CRITICAL"`, a plain string
-    // containing the word) that real osv-scanner never actually produces. This does not create
-    // a false "safe" verdict (`scanSkillDir.ok` still goes `false` on `high`), but it does mean
-    // the `critical` severity tier is currently unreachable from real osv-scanner output.
+    // `[{"type":"CVSS_V3","score":"CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H"}]`, so the
+    // old code always fell back to `'high'` regardless of actual severity. The fix computes
+    // a real CVSS 3.1 Base Score from that vector and classifies via the spec's own rating
+    // table, falling back to osv's `database_specific.severity` when no vector is present.
+    // Verified directly against this exact fixture: lodash 4.17.15's real advisories split
+    // across `medium` and `high` (none reach `critical` for this specific package/version,
+    // which is expected — not every known vulnerability is critical), matching osv-scanner's
+    // own curated `database_specific.severity` field exactly. The old code could only ever
+    // produce `'critical'` or `'high'` — never anything lower — so real differentiation
+    // (seeing a `'medium'` here at all) is itself proof the fix works, not a fluke:
+    assert.ok(
+      result.findings.some((f) => f.severity === 'medium'),
+      'fixed: severity is now computed from the real CVSS vector, so a known-non-critical advisory should classify below high -- the old substring-matching bug could only ever produce "critical" or "high"',
+    );
     assert.ok(
-      result.findings.every((f) => f.severity !== 'critical'),
-      'documents the bug: no real osv-scanner finding is ever classified critical today, regardless of actual CVSS score — see comment above',
+      result.findings.some((f) => f.severity === 'high'),
+      'fixed: at least one of these advisories is genuinely CVSS-high-rated and should still classify as high',
     );
   });
 });
```

With both the source patch and this test diff applied, `node --test` on
`test/guard/vet-external.test.ts` passes every test except the 3 that were
*already* failing beforehand for an unrelated, pre-existing reason: semgrep
and osv-scanner are genuinely installed on this dev machine, so the 3 tests
written to assert "the binary is absent" fail here (they pass in CI, which
has neither binary — that's the designed behavior, not something either
patch touches):

- `runSemgrep degrades to skipped when the binary is genuinely absent (no fake exec)`
- `runOsvScanner degrades to skipped when the binary is genuinely absent (no fake exec)`
- `scanSkillDir never fails just because semgrep/osv-scanner are absent — pattern scan still runs`
