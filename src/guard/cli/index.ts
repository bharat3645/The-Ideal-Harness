#!/usr/bin/env node
/**
 * ideal-harness-guard — enforcement-floor CLI.
 *
 * Commands:
 *   mcp                 start the guard MCP server (stdio)
 *   vet <file>          scan a skill/script file; exit 1 if it fails vetting
 *   policy <json>       evaluate a `{tool,input}` request; print the decision
 *   redact              redact secrets from stdin
 *   learn [minCount]    propose allow rules from repeated approvals in the
 *                       decision journal — proposals only, human-ratified
 */

import { readFile } from 'node:fs/promises';
import { readStdin, runCli } from '../../core/index.js';
import { formatProposals, learnFromJournal } from '../learn.js';
import { DEFAULT_RULES } from '../policy/defaults.js';
import { evaluate } from '../policy/engine.js';
import { redactSecrets } from '../redact.js';
import { startGuardMcp } from '../runtime/mcp.js';
import { scanSkill } from '../vet/scan.js';

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case 'mcp':
      await startGuardMcp();
      return 0;
    case 'vet': {
      const file = rest[0];
      if (file === undefined) {
        process.stderr.write('usage: ideal-harness-guard vet <file>\n');
        return 1;
      }
      const result = scanSkill(await readFile(file, 'utf8'));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    case 'policy': {
      const json = rest[0];
      if (json === undefined) {
        process.stderr.write('usage: ideal-harness-guard policy \'{"tool":"Bash","input":{"command":"..."}}\'\n');
        return 1;
      }
      const request = JSON.parse(json);
      process.stdout.write(`${JSON.stringify(evaluate(request, DEFAULT_RULES))}\n`);
      return 0;
    }
    case 'redact': {
      const result = redactSecrets(await readStdin());
      process.stdout.write(result.text);
      process.stderr.write(`\n[redacted ${result.count} secret(s): ${result.types.join(', ')}]\n`);
      return 0;
    }
    case 'learn': {
      const minCount = rest[0] !== undefined ? Number.parseInt(rest[0], 10) : undefined;
      if (minCount !== undefined && (!Number.isFinite(minCount) || minCount < 1)) {
        process.stderr.write('usage: ideal-harness-guard learn [minCount >= 1]\n');
        return 1;
      }
      process.stdout.write(formatProposals(learnFromJournal(process.cwd(), minCount)));
      return 0;
    }
    default:
      process.stdout.write('usage: ideal-harness-guard <mcp|vet|policy|redact|learn>\n');
      return command === undefined ? 1 : 0;
  }
}

runCli('ideal-harness-guard', main);
