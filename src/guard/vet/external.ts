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
 * Neither binary was available in this repo's own dev environment while this
 * module was built, so only the "absence" path is exercised against the real
 * binaries; the parsing/merging logic is covered by tests with an injected
 * fake `execFn` standing in for a present tool (see `test/guard/
 * vet-external.test.ts`). Stated plainly, per the project's honesty rule.
 */

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ExecResult, execCommand } from '../exec.js';
import { DEFAULT_RULES } from '../policy/defaults.js';
import { evaluateTiered } from '../policy/engine.js';
import type { PolicyDecision, PolicyRule } from '../policy/types.js';
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

async function binaryAvailable(bin: string, execFn: ExecFn): Promise<boolean> {
  const result = await execFn([bin, '--version'], null, {
    cwd: process.cwd(),
    env: {},
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

function parseSemgrepOutput(stdout: string): ScanFinding[] {
  let parsed: { results?: readonly SemgrepResultEntry[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const results = parsed.results ?? [];
  return results.map((r) => ({
    id: r.check_id ?? 'sg-unknown',
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
      env: {},
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
}

interface OsvPackageEntry {
  readonly package?: { readonly name?: string; readonly version?: string; readonly ecosystem?: string };
  readonly vulnerabilities?: readonly OsvVulnerability[];
}

interface OsvResultSource {
  readonly packages?: readonly OsvPackageEntry[];
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
        const critical = /critical/i.test(JSON.stringify(vuln.severity ?? ''));
        findings.push({
          id: vuln.id ?? 'osv-unknown',
          category: 'osv-advisory',
          severity: critical ? 'critical' : 'high',
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
    env: {},
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
