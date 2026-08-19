#!/usr/bin/env node

/**
 * ideal-harness-orchestrate — orchestration CLI.
 *
 * Commands:
 *   mcp                start the orchestrate MCP server (stdio). Spend cap via IDEAL_HARNESS_SPEND_CAP.
 *   verify <taskId>     actually run a ledger task's verify.command and update its status
 *   retro               generate a markdown retro from the current ledger
 *   spend reset         deliberately clear persisted spend tracking back to zero (see issue #14)
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runCli } from '../../core/index.js';
import { TaskLedger } from '../ledger.js';
import { generateRetro } from '../retro.js';
import { spendStatePath, startOrchestrateMcp } from '../runtime/mcp.js';
import { serializeSpendState } from '../spend.js';
import { runVerify } from '../verify.js';

function ledgerPath(): string {
  return process.env.IDEAL_HARNESS_LEDGER ?? join(process.cwd(), '.ideal-harness', 'orchestrate-ledger.json');
}

async function loadLedger(): Promise<TaskLedger | null> {
  try {
    return TaskLedger.parse(await readFile(ledgerPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveLedger(ledger: TaskLedger): void {
  const path = ledgerPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, ledger.serialize());
  renameSync(tmp, path);
}

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case 'mcp':
      await startOrchestrateMcp();
      return 0;
    case 'verify': {
      const id = rest[0];
      if (id === undefined) {
        process.stderr.write('usage: ideal-harness-orchestrate verify <taskId>\n');
        return 1;
      }
      const ledger = await loadLedger();
      if (ledger === null) {
        process.stderr.write(`no ledger found at ${ledgerPath()}\n`);
        return 1;
      }
      const task = ledger.get(id);
      if (task === undefined) {
        process.stderr.write(`no ledger task with id "${id}"\n`);
        return 1;
      }
      if (task.verify === undefined) {
        process.stderr.write(`task "${id}" has no verify.command set\n`);
        return 1;
      }
      const result = await runVerify(task.verify, { cwd: process.cwd() });
      const notes = result.ran
        ? `verify: ${result.ok ? 'PASSED' : 'FAILED'} (exit ${result.exitCode}${result.expectMatched === false ? ', expect not matched' : ''})`
        : `verify: BLOCKED — policy decision was "${result.decision.action}" (${result.decision.reason})`;
      if (result.ran) {
        ledger.update(id, { status: result.ok ? 'done' : 'failed', notes });
        saveLedger(ledger);
      }
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ran && result.ok ? 0 : 1;
    }
    case 'spend': {
      if (rest[0] !== 'reset') {
        process.stderr.write('usage: ideal-harness-orchestrate spend reset\n');
        return 1;
      }
      const path = spendStatePath();
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, serializeSpendState({ used: 0, ts: Date.now() }));
      renameSync(tmp, path);
      process.stderr.write(`spend tracking reset to 0 at ${path}\n`);
      return 0;
    }
    case 'retro': {
      const ledger = await loadLedger();
      if (ledger === null) {
        process.stderr.write(`no ledger found at ${ledgerPath()}\n`);
        return 1;
      }
      const markdown = generateRetro(ledger.all(), { now: Date.now() });
      const outPath = rest[0];
      if (outPath !== undefined) {
        await writeFile(outPath, markdown, 'utf8');
        process.stderr.write(`retro written to ${outPath}\n`);
      } else {
        process.stdout.write(markdown);
      }
      return 0;
    }
    default:
      process.stdout.write('usage: ideal-harness-orchestrate <mcp|verify|retro|spend reset>\n');
      return command === undefined ? 1 : 0;
  }
}

runCli('ideal-harness-orchestrate', main);
