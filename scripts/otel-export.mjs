#!/usr/bin/env node

/**
 * `node scripts/otel-export.mjs [targetProjectDir]` — issue #18.
 *
 * Maps the guard decision journal onto OTLP/HTTP JSON spans, by hand, with
 * stdlib `fetch` and `node:crypto` only (Option 1 from the issue) — the
 * OTel SDK is not small, and this project ships zero runtime dependencies
 * as a defended, publicly stated property (decisions.md D007). No new
 * dependency, optional or otherwise, is needed to speak the wire format.
 *
 * Lives here, not in src/guard, for two reasons: (1) the same reason
 * report.mjs and doctor.mjs do — it reads guard's dist/ output like any
 * Tier-2 consumer rather than inverting core's zero-deps rule; (2) guard's
 * own self-policy floor denies Edit/Write anywhere under src/guard/ —
 * including new files — so a capability that only *reads* the journal has
 * to live outside the module it reads from. See decisions.md D040.
 *
 * There is no OTel GenAI semantic-convention mapping here on purpose: GenAI
 * semconv (`gen_ai.*`) describes model-inference calls (system, request
 * model, token usage). A guard decision is a tool-permission check, not an
 * inference call, so it carries none of those fields. Every attribute below
 * is under the `ideal_harness.*` namespace instead — documented plainly,
 * per the issue, rather than forced into a convention that doesn't fit.
 *
 * Redaction: the journal already redacts + truncates `subject` at write
 * time (`buildJournalEntry` in journal.ts calls `redactSecrets`). This
 * script re-emits that same already-scrubbed string — it never re-derives
 * from raw tool input, so it cannot leak what the journal already masks.
 *
 * Opt-in and fails open: nothing is exported unless this script is run.
 * Nothing here touches the PreToolUse/PostToolUse hook path, so a failed
 * export (bad endpoint, network down) can never block or slow a tool call
 * — the worst case is spans stay queued in the cursor for the next run.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guardModuleUrl = pathToFileURL(join(HARNESS_ROOT, 'dist', 'guard', 'index.js')).href;
const pkg = JSON.parse(readFileSync(join(HARNESS_ROOT, 'package.json'), 'utf8'));

const target = resolve(process.argv[2] ?? process.cwd());
const journalFile = join(target, '.ideal-harness', 'guard-journal.jsonl');
const statePath = process.env.IDEAL_HARNESS_OTEL_STATE ?? join(target, '.ideal-harness', 'otel-export-state.json');
const outputPath = process.env.IDEAL_HARNESS_OTEL_OUTPUT ?? join(target, '.ideal-harness', 'otel-spans.json');
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'ideal-harness-guard';

/** Standard OTel env-var precedence: a signal-specific endpoint wins outright; the general
 *  endpoint gets the per-signal path appended, matching every other OTLP/HTTP exporter. */
function resolveEndpoint() {
  const specific = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (specific) {
    return specific;
  }
  const general = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return general ? `${general.replace(/\/+$/, '')}/v1/traces` : null;
}

/** `key1=value1,key2=value2` per the standard `OTEL_EXPORTER_OTLP_HEADERS` convention. */
function resolveHeaders() {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS?.trim();
  const headers = { 'content-type': 'application/json' };
  if (!raw) {
    return headers;
  }
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
  return headers;
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    return typeof parsed.exportedCount === 'number' ? parsed.exportedCount : 0;
  } catch {
    return 0;
  }
}

function writeState(exportedCount) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ exportedCount }, null, 2), 'utf8');
}

function unixNanos(iso) {
  const ms = Date.parse(iso);
  return (BigInt(Number.isFinite(ms) ? ms : 0) * 1_000_000n).toString();
}

function attr(key, value) {
  if (typeof value === 'boolean') {
    return { key, value: { boolValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

/** One guard journal entry -> one OTLP span. A decision is instantaneous, so start == end. */
function toSpan(entry) {
  const ts = unixNanos(entry.ts);
  return {
    traceId: randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    name: `guard.decision.${entry.action}`,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: ts,
    endTimeUnixNano: ts,
    attributes: [
      attr('ideal_harness.tool', entry.tool),
      attr('ideal_harness.action', entry.action),
      attr('ideal_harness.rule_id', entry.ruleId),
      attr('ideal_harness.mode', entry.mode),
      attr('ideal_harness.softened', entry.softened === true),
      // Already redacted + truncated by journal.ts at write time — see module docblock.
      attr('ideal_harness.subject', entry.subject),
    ],
    status: { code: entry.action === 'deny' ? 2 : 1 }, // STATUS_CODE_ERROR : STATUS_CODE_OK
  };
}

function buildPayload(spans) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [attr('service.name', serviceName), attr('service.namespace', 'ideal-harness')],
        },
        scopeSpans: [
          {
            scope: { name: 'ideal-harness-guard', version: pkg.version },
            spans,
          },
        ],
      },
    ],
  };
}

async function main() {
  const { parseJournal } = await import(guardModuleUrl);
  const entries = existsSync(journalFile) ? parseJournal(readFileSync(journalFile, 'utf8')) : [];
  const alreadyExported = readState();
  const fresh = entries.slice(alreadyExported);

  if (fresh.length === 0) {
    process.stderr.write(`otel-export: no new journal entries (${alreadyExported} already exported)\n`);
    return;
  }

  const payload = buildPayload(fresh.map(toSpan));
  const endpoint = resolveEndpoint();

  if (endpoint === null) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    writeState(entries.length);
    process.stderr.write(
      `otel-export: no OTEL_EXPORTER_OTLP_ENDPOINT set — wrote ${fresh.length} span(s) to ${outputPath}\n`,
    );
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: resolveHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`collector responded ${response.status} ${response.statusText}`);
    }
    writeState(entries.length);
    process.stderr.write(`otel-export: posted ${fresh.length} span(s) to ${endpoint}\n`);
  } catch (error) {
    // Deliberately does NOT advance the cursor — the same batch retries next run.
    // This never touches the PreToolUse/PostToolUse path, so no tool call is affected.
    process.stderr.write(`otel-export: export failed, will retry next run: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`otel-export failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
