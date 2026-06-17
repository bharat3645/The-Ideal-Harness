#!/usr/bin/env node
/**
 * ideal-harness-guard — enforcement-floor CLI.
 *
 * Commands:
 *   mcp                 start the guard MCP server (stdio)
 *   vet <file>          scan a skill/script file; exit 1 if it fails vetting
 *   policy <json>       evaluate a `{tool,input}` request; print the decision
 *   redact              redact secrets from stdin
 */

import { readFile } from 'node:fs/promises';
import { DEFAULT_RULES } from '../policy/defaults.js';
import { evaluate } from '../policy/engine.js';
import { redactSecrets } from '../redact.js';
import { startGuardMcp } from '../runtime/mcp.js';
import { scanSkill } from '../vet/scan.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

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
    default:
      process.stdout.write('usage: ideal-harness-guard <mcp|vet|policy|redact>\n');
      return command === undefined ? 1 : 0;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`ideal-harness-guard: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
