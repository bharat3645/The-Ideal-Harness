/**
 * Deeper, optional skill vetting: shells out to semgrep (AST rules, fully
 * offline — our own bundled ruleset, no registry fetch) and osv-scanner
 * (dependency-vulnerability lookup against osv.dev, live network) when the
 * binaries are present on PATH. `IMPLEMENTATION.md`'s original M2 spec named
 * both alongside the signature DB + homoglyph check; only that half shipped
 * before now (`decisions.md` D027). Neither tool is a hard dependency —
 * absence degrades to "skipped", the same honesty pattern drift-guard uses
 * for its tree-sitter/grep tier fallback: a lower-confidence result, never a
 * hard failure of the vet itself.
 *
 * Both invocations are gated exactly like `orchestrate/verify.ts`'s
 * `runVerify` gates a task's verify command: evaluated as a `Bash` request
 * against the caller's policy tiers with NO floor-mode softening — only an
 * explicit `allow` runs. osv-scanner's network egress makes this gate
 * load-bearing (same class of exposure the `web` module's SSRF guard closes
 * for `web_fetch`); semgrep's is defense-in-depth, since our ruleset never
 * leaves the machine, but it is still arbitrary external-binary execution.
 *
 * Real-binary integration tests (`test/guard/vet-external.test.ts`, issue #7)
 * found and fixed 3 genuine bugs (issue #36): `parseSemgrepOutput`'s `id` was
 * semgrep's raw, path-prefixed `check_id` rather than the bare rule id;
 * `parseOsvOutput`'s severity classification substring-matched the word
 * "critical" against a field that is actually an array of CVSS vector
 * strings (which never contain that word), so `critical` was unreachable;
 * and both exec call sites passed `env: {}`, which breaks semgrep's Windows
 * Python entry point. Fixed here rather than left documented-but-broken.
 */

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ExecResult, execCommand } from '../exec.js';
import { DEFAULT_RULES } from '../policy/defaults.js';
import { evaluateTiered } from '../policy/engine.js';
import type { PolicyDecision, PolicyRule } from '../policy/types.js';
import { scrubEnv } from '../sandbox.js';
import type { Severity } from './patterns.js';
import { type ScanFinding, SEVERITY_ORDER, scanSkill } from './scan.js';

export type ExecFn = (
  argv: readonly string[] | null,
  shellCommand: string | null,
  options: { cwd: string; env: Record<string, string>; timeoutMs: number },
) => Promise<ExecResult>;

export interface ExternalScanResult {
  readonly tool: 'semgrep' | 'osv-scanner';
  readonly available: boolean;
  readonly ran: boolean;
  readonly findings: readonly ScanFinding[];
  readonly note?: string;
  readonly decision?: PolicyDecision;
}

export interface ExternalScanOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Policy tiers to gate the shell-out against, most specific first. Defaults to just the floor. */
  readonly policyTiers?: readonly (readonly PolicyRule[])[];
  readonly execFn?: ExecFn;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const AVAILABILITY_TIMEOUT_MS = 5_000;

/**
 * A scrubbed copy of this process's own env, not `{}`. An empty environment
 * breaks semgrep's Windows Python entry point (`ModuleNotFoundError: No
 * module named 'semgrep'` — confirmed directly; osv-scanner, a static Go
 * binary, tolerates `{}` fine, which is why this went unnoticed until real
 * binaries were exercised). `scrubEnv` still strips anything secret-shaped
 * before it reaches either subprocess, so this isn't "just pass everything
 * through" — it's the same non-secret allowlist-by-exclusion sandbox.ts
 * already uses for every other shelled-out command.
 */
function childEnv(): Record<string, string> {
  return scrubEnv(process.env);
}

async function binaryAvailable(bin: string, execFn: ExecFn): Promise<boolean> {
  const result = await execFn([bin, '--version'], null, {
    cwd: process.cwd(),
    env: childEnv(),
    timeoutMs: AVAILABILITY_TIMEOUT_MS,
  });
  return result.exitCode === 0;
}

function gate(command: string, tiers: readonly (readonly PolicyRule[])[]): PolicyDecision {
  return evaluateTiered({ tool: 'Bash', input: { command } }, tiers);
}

// A clean-room, deliberately small AST ruleset — not a port of semgrep's own
// registry (that would need network access to fetch, defeating the point of
// running it offline). Covers the classes our regex-tier DB can't reliably
// reach: code-execution sinks that only an AST can distinguish from a string
// that merely mentions the same words in a comment.
const SEMGREP_RULES = `rules:
  - id: sg-js-eval
    languages: [javascript, typescript]
    severity: ERROR
    message: eval() executes arbitrary code from a runtime value.
    pattern: eval(...)
  - id: sg-js-child-process-exec
    languages: [javascript, typescript]
    severity: WARNING
    message: child_process.exec/execSync runs a shell command — check the argument isn't attacker-influenced.
    pattern-either:
      - pattern: child_process.exec(...)
      - pattern: child_process.execSync(...)
  - id: sg-py-eval-exec
    languages: [python]
    severity: ERROR
    message: eval()/exec() executes arbitrary code from a runtime value.
    pattern-either:
      - pattern: eval(...)
      - pattern: exec(...)
  - id: sg-py-subprocess-shell-true
    languages: [python]
    severity: WARNING
    message: subprocess call with shell=True — check the command isn't attacker-influenced.
    pattern-either:
      - pattern: subprocess.run(..., shell=True, ...)
      - pattern: subprocess.Popen(..., shell=True, ...)
      - pattern: subprocess.call(..., shell=True, ...)
      - pattern: os.system(...)
  - id: sg-py-pickle-loads
    languages: [python]
    severity: WARNING
    message: pickle.loads on untrusted data can execute arbitrary code during deserialization.
    pattern: pickle.loads(...)
  - id: sg-py-yaml-unsafe-load
    languages: [python]
    severity: WARNING
    message: yaml.load without a SafeLoader can execute arbitrary code.
    pattern: yaml.load($X)
`;

function mapSemgrepSeverity(raw: unknown): Severity {
  const s = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (s === 'ERROR') {
    return 'high';
  }
  if (s === 'WARNING') {
    return 'medium';
  }
  return 'low';
}

interface SemgrepResultEntry {
  readonly check_id?: string;
  readonly path?: string;
  readonly start?: { readonly line?: number };
  readonly extra?: { readonly message?: string; readonly severity?: string };
}

/**
 * `runSemgrep` always points `--config` at a rules file it writes itself
 * (`<tmpdir>/rules.yml` — see below), never the hosted registry. Real semgrep
 * does not return the bare rule id from that file's YAML when the config is
 * a local path: it synthesizes `check_id` by dot-joining the config's own
 * absolute path and appending the rule id — verified directly against real
 * semgrep 1.173.0 output: `C.Users.<...>.ih-semgrep-XXXXXX.sg-js-eval`, not
 * `sg-js-eval` (an earlier guess that the path segment ended in a literal
 * `.rules.` before the id, matching the rules file's own name, does not
 * match what semgrep actually emits — corrected after running the real
 * binary rather than left as an untested assumption). Since our own rule
 * ids never contain a dot, the bare id is reliably the LAST dot-separated
 * segment of `check_id` regardless of how many path segments precede it —
 * stripping everything up to and including the final dot recovers it
 * without hardcoding (and needing to keep in sync with) the specific ids in
 * `SEMGREP_RULES` above. A check_id that never went through this prefixing
 * (e.g. the exec-faked tests' synthetic stdout) has no dot at all, so the
 * replace is a no-op and the id passes through unchanged.
 */
function bareRuleId(checkId: string): string {
  return checkId.replace(/^.*\./, '');
}

function parseSemgrepOutput(stdout: string): ScanFinding[] {
  let parsed: { results?: readonly SemgrepResultEntry[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const results = parsed.results ?? [];
  return results.map((r) => ({
    id: r.check_id !== undefined ? bareRuleId(r.check_id) : 'sg-unknown',
    category: 'semgrep' as const,
    severity: mapSemgrepSeverity(r.extra?.severity),
    evidence: `${r.path ?? '?'}:${r.start?.line ?? '?'} — ${r.extra?.message ?? r.check_id ?? 'semgrep finding'}`,
    remediation: 'Reported by semgrep (bundled offline ruleset). Review the flagged code before trusting this skill.',
  }));
}

/**
 * Run the bundled offline semgrep ruleset against a skill directory.
 * Fully offline: `--config` points at a rules file we write ourselves, never
 * the hosted registry, so this never makes a network call.
 */
export async function runSemgrep(dir: string, options: ExternalScanOptions = {}): Promise<ExternalScanResult> {
  const execFn = options.execFn ?? execCommand;
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tiers = options.policyTiers ?? [DEFAULT_RULES];

  const available = await binaryAvailable('semgrep', execFn);
  if (!available) {
    return {
      tool: 'semgrep',
      available: false,
      ran: false,
      findings: [],
      note: 'semgrep not found on PATH — skipped (optional deeper vetting, not a hard dependency).',
    };
  }

  let rulesDir: string | undefined;
  try {
    rulesDir = await mkdtemp(join(tmpdir(), 'ih-semgrep-'));
    const rulesFile = join(rulesDir, 'rules.yml');
    await writeFile(rulesFile, SEMGREP_RULES, 'utf8');

    const command = `semgrep --config "${rulesFile}" --json --quiet --metrics=off "${dir}"`;
    const decision = gate(command, tiers);
    if (decision.action !== 'allow') {
      return { tool: 'semgrep', available: true, ran: false, findings: [], decision };
    }

    const result = await execFn(['semgrep', '--config', rulesFile, '--json', '--quiet', '--metrics=off', dir], null, {
      cwd,
      env: childEnv(),
      timeoutMs,
    });
    if (result.timedOut) {
      return { tool: 'semgrep', available: true, ran: false, findings: [], note: 'semgrep timed out', decision };
    }
    return { tool: 'semgrep', available: true, ran: true, findings: parseSemgrepOutput(result.stdout), decision };
  } finally {
    if (rulesDir !== undefined) {
      await rm(rulesDir, { recursive: true, force: true });
    }
  }
}

interface OsvVulnerability {
  readonly id?: string;
  readonly summary?: string;
  readonly severity?: readonly unknown[];
  readonly database_specific?: { readonly severity?: unknown };
}

interface OsvPackageEntry {
  readonly package?: { readonly name?: string; readonly version?: string; readonly ecosystem?: string };
  readonly vulnerabilities?: readonly OsvVulnerability[];
}

interface OsvResultSource {
  readonly packages?: readonly OsvPackageEntry[];
}

// --- CVSS 3.1 Base Score, per the official spec (§7.4 formula, §5 rating table) ---
// Real `osv-scanner` output puts a CVSS VECTOR STRING in `vulnerabilities[].severity`
// (e.g. "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), not a plain severity word —
// the bug this replaces substring-matched for the literal word "critical" against
// that vector, which never appears in it, so `critical` was unreachable from any real
// finding regardless of actual CVSS score. Verified against real osv-scanner 1.9.2
// output (a real lodash 4.17.15 scan) cross-checked against osv's own curated
// `database_specific.severity` rating: this implementation reproduces the same HIGH
// verdict osv-scanner itself reports for GHSA-35jh-r3h4-6jhm and GHSA-r5fr-rjxr-66jc.

const CVSS3_AV: Readonly<Record<string, number>> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const CVSS3_AC: Readonly<Record<string, number>> = { L: 0.77, H: 0.44 };
const CVSS3_PR_UNCHANGED: Readonly<Record<string, number>> = { N: 0.85, L: 0.62, H: 0.27 };
const CVSS3_PR_CHANGED: Readonly<Record<string, number>> = { N: 0.85, L: 0.68, H: 0.5 };
const CVSS3_UI: Readonly<Record<string, number>> = { N: 0.85, R: 0.62 };
const CVSS3_CIA: Readonly<Record<string, number>> = { H: 0.56, L: 0.22, N: 0 };

/**
 * CVSS's own "round up to one decimal place" (spec Appendix A) — plain
 * `Math.round(x * 10) / 10` is not equivalent for the floating-point edge
 * cases the spec's algorithm exists specifically to guard against.
 */
function cvssRoundUp(input: number): number {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) {
    return intInput / 100000;
  }
  return (Math.floor(intInput / 10000) + 1) / 10;
}

/**
 * Parse a CVSS 3.x vector string into its numeric Base Score. Returns `null`
 * for anything that isn't a recognizable, fully-specified CVSS 3.x vector —
 * callers must treat `null` as "couldn't score this", never coerce it to 0
 * (0 is a real, valid "no impact" score).
 */
function parseCvss3BaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) {
    return null;
  }
  const metrics: Record<string, string> = {};
  for (const part of vector.split('/').slice(1)) {
    const [key, value] = part.split(':');
    if (key && value) {
      metrics[key] = value;
    }
  }
  const scopeChanged = metrics.S === 'C';
  const av = CVSS3_AV[metrics.AV ?? ''];
  const ac = CVSS3_AC[metrics.AC ?? ''];
  const pr = (scopeChanged ? CVSS3_PR_CHANGED : CVSS3_PR_UNCHANGED)[metrics.PR ?? ''];
  const ui = CVSS3_UI[metrics.UI ?? ''];
  const c = CVSS3_CIA[metrics.C ?? ''];
  const i = CVSS3_CIA[metrics.I ?? ''];
  const a = CVSS3_CIA[metrics.A ?? ''];
  if (
    av === undefined ||
    ac === undefined ||
    pr === undefined ||
    ui === undefined ||
    c === undefined ||
    i === undefined ||
    a === undefined
  ) {
    return null; // unrecognized/incomplete metric — do not guess
  }

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) {
    return 0;
  }
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scopeChanged ? 1.08 * (impact + exploitability) : impact + exploitability;
  return cvssRoundUp(Math.min(raw, 10));
}

/** CVSS 3.1 qualitative severity rating, spec §5's table. */
function severityFromCvssScore(score: number): Severity {
  if (score >= 9.0) {
    return 'critical';
  }
  if (score >= 7.0) {
    return 'high';
  }
  if (score >= 4.0) {
    return 'medium';
  }
  return 'low'; // covers 0.1-3.9; a genuine 0.0 ("None") never reaches here as a finding
}

/** The source advisory database's own curated rating (e.g. GHSA), when osv-scanner's
 *  output carries one — a same-strength fallback for a vulnerability whose `severity`
 *  array has no parseable CVSS vector (some ecosystems/advisories omit CVSS entirely). */
function severityFromDatabaseRating(raw: unknown): Severity | null {
  const s = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (s === 'CRITICAL') {
    return 'critical';
  }
  if (s === 'HIGH') {
    return 'high';
  }
  if (s === 'MODERATE' || s === 'MEDIUM') {
    return 'medium';
  }
  if (s === 'LOW') {
    return 'low';
  }
  return null;
}

function severityFromOsvVuln(vuln: OsvVulnerability): Severity {
  let best: number | null = null;
  for (const entry of vuln.severity ?? []) {
    const score =
      typeof entry === 'object' && entry !== null && 'score' in entry
        ? (entry as { score?: unknown }).score
        : undefined;
    if (typeof score === 'string') {
      const parsed = parseCvss3BaseScore(score);
      if (parsed !== null && (best === null || parsed > best)) {
        best = parsed;
      }
    }
  }
  if (best !== null) {
    return severityFromCvssScore(best);
  }
  const dbRating = severityFromDatabaseRating(vuln.database_specific?.severity);
  if (dbRating !== null) {
    return dbRating;
  }
  // Neither a parseable CVSS vector nor a database rating was present, but this is
  // still a KNOWN vulnerability (osv-scanner found and reported it) — never silently
  // under-report an unscoreable finding as merely 'low'.
  return 'high';
}

function parseOsvOutput(stdout: string): ScanFinding[] {
  let parsed: { results?: readonly OsvResultSource[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const findings: ScanFinding[] = [];
  for (const source of parsed.results ?? []) {
    for (const pkg of source.packages ?? []) {
      const name = pkg.package?.name ?? 'unknown';
      const version = pkg.package?.version ?? '?';
      const ecosystem = pkg.package?.ecosystem ?? '?';
      for (const vuln of pkg.vulnerabilities ?? []) {
        findings.push({
          id: vuln.id ?? 'osv-unknown',
          category: 'osv-advisory',
          severity: severityFromOsvVuln(vuln),
          evidence: `${name}@${version} (${ecosystem}): ${vuln.id ?? 'unknown advisory'}${vuln.summary ? ` — ${vuln.summary}` : ''}`,
          remediation:
            'Known vulnerability in a declared dependency — upgrade or replace the package before trusting this skill.',
        });
      }
    }
  }
  return findings;
}

/**
 * Run osv-scanner against a skill directory's lockfile(s), if any. This is
 * the one shell-out in the harness that does live network I/O (queries
 * osv.dev) purely from the presence of a lockfile — gated identically to a
 * Bash tool call for exactly that reason.
 */
export async function runOsvScanner(dir: string, options: ExternalScanOptions = {}): Promise<ExternalScanResult> {
  const execFn = options.execFn ?? execCommand;
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tiers = options.policyTiers ?? [DEFAULT_RULES];

  const available = await binaryAvailable('osv-scanner', execFn);
  if (!available) {
    return {
      tool: 'osv-scanner',
      available: false,
      ran: false,
      findings: [],
      note: 'osv-scanner not found on PATH — skipped (optional deeper vetting, not a hard dependency).',
    };
  }

  const command = `osv-scanner --format json --recursive "${dir}"`;
  const decision = gate(command, tiers);
  if (decision.action !== 'allow') {
    return { tool: 'osv-scanner', available: true, ran: false, findings: [], decision };
  }

  const result = await execFn(['osv-scanner', '--format', 'json', '--recursive', dir], null, {
    cwd,
    env: childEnv(),
    timeoutMs,
  });
  if (result.timedOut) {
    return { tool: 'osv-scanner', available: true, ran: false, findings: [], note: 'osv-scanner timed out', decision };
  }
  // osv-scanner exits non-zero when it finds vulnerabilities (and also on
  // some "no lockfile found" cases) — parse whatever JSON it produced either way.
  return { tool: 'osv-scanner', available: true, ran: true, findings: parseOsvOutput(result.stdout), decision };
}

const MAX_FILE_BYTES = 2_000_000;
const SKIP_DIRS = new Set(['node_modules', '.git']);

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function collectPatternFindings(dir: string): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  for (const filePath of await listFilesRecursive(dir)) {
    try {
      const info = await stat(filePath);
      if (info.size > MAX_FILE_BYTES) {
        continue;
      }
      findings.push(...scanSkill(await readFile(filePath, 'utf8')).findings);
    } catch {
      // unreadable or binary file — skip, never fail the vet over it
    }
  }
  return findings;
}

export interface DeepScanResult {
  readonly findings: readonly ScanFinding[];
  readonly maxSeverity: Severity | 'none';
  /** Vetting verdict: false if any finding is `high` or `critical`. */
  readonly ok: boolean;
  readonly externalTools: readonly {
    readonly tool: 'semgrep' | 'osv-scanner';
    readonly available: boolean;
    readonly ran: boolean;
    readonly note?: string;
  }[];
}

/**
 * Full vetting pass over a skill DIRECTORY: the existing regex + hidden-char
 * scan run over every file, plus semgrep and osv-scanner when present.
 * `vet_skill` (text-only) stays the fast, always-available default; this is
 * the deeper, optional path for a skill about to be installed, not every
 * inline scan.
 */
export async function scanSkillDir(dir: string, options: ExternalScanOptions = {}): Promise<DeepScanResult> {
  const [patternFindings, semgrep, osv] = await Promise.all([
    collectPatternFindings(dir),
    runSemgrep(dir, options),
    runOsvScanner(dir, options),
  ]);

  const findings = [...patternFindings, ...semgrep.findings, ...osv.findings];
  let max = 0;
  for (const f of findings) {
    max = Math.max(max, SEVERITY_ORDER[f.severity]);
  }
  const maxSeverity = (Object.keys(SEVERITY_ORDER) as Severity[]).find((s) => SEVERITY_ORDER[s] === max) ?? 'none';

  return {
    findings,
    maxSeverity,
    ok: max < SEVERITY_ORDER.high,
    externalTools: [semgrep, osv].map((r) => ({
      tool: r.tool,
      available: r.available,
      ran: r.ran,
      ...(r.note !== undefined ? { note: r.note } : {}),
    })),
  };
}
