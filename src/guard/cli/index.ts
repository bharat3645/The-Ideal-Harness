#!/usr/bin/env node
/**
 * ideal-harness-guard — enforcement-floor CLI.
 *
 * Commands:
 *   mcp                 start the guard MCP server (stdio)
 *   vet <file>          scan a skill/script file; exit 1 if it fails vetting
 *   vet --deep <dir>    scan a skill directory: pattern scan over every file
 *                       + semgrep/osv-scanner if present on PATH; exit 1 if
 *                       it fails vetting
 *   policy <json>       evaluate a `{tool,input}` request; print the decision
 *   redact              redact secrets from stdin
 *   learn [minCount]    propose allow rules from repeated approvals in the
 *                       decision journal — proposals only, human-ratified
 *   ratify <shape>      propose an allow rule from ONE approval of <shape>
 *                       (e.g. "npm test"), bypassing the repeat threshold
 *   asks                digest of pending/recent ask decisions, grouped and
 *                       counted, for one batch review pass
 *   verify-journal      check the decision journal's hash chain for tampering
 *   lease grant <json>  grant a time/call-boxed capability lease (human only)
 *   lease list          list current leases and their live/expired status
 *   lease revoke <id>   revoke a lease by id
 */

import { readFile } from 'node:fs/promises';
import { readStdin, runCli } from '../../core/index.js';
import { journalPath, parseJournal, verifyJournalChain } from '../journal.js';
import { formatAskDigest, formatProposals, learnFromJournal, ratifyFromJournal, summarizeAsks } from '../learn.js';
import { type CapabilityLease, grantLease, isLeaseLive, loadLeases, revokeLease } from '../leases.js';
import { DEFAULT_RULES } from '../policy/defaults.js';
import { evaluate } from '../policy/engine.js';
import { redactSecrets } from '../redact.js';
import { resolveOperatorTiers } from '../resolve.js';
import { startGuardMcp } from '../runtime/mcp.js';
import { scanSkillDir } from '../vet/external.js';
import { scanSkill } from '../vet/scan.js';

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case 'mcp':
      await startGuardMcp();
      return 0;
    case 'vet': {
      if (rest[0] === '--deep') {
        const dir = rest[1];
        if (dir === undefined) {
          process.stderr.write('usage: ideal-harness-guard vet --deep <dir>\n');
          return 1;
        }
        const { tiers } = resolveOperatorTiers();
        const result = await scanSkillDir(dir, { policyTiers: tiers });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.ok ? 0 : 1;
      }
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
    case 'ratify': {
      const shape = rest.join(' ').trim();
      if (shape === '') {
        process.stderr.write('usage: ideal-harness-guard ratify <shape>  (e.g. "npm test")\n');
        return 1;
      }
      const proposal = ratifyFromJournal(shape, process.cwd());
      if (proposal === null) {
        process.stdout.write(
          `No proposal: "${shape}" was never approved in the journal, or it was ever denied/softened.\n`,
        );
        return 0;
      }
      process.stdout.write(formatProposals([proposal]));
      return 0;
    }
    case 'asks': {
      let text: string;
      try {
        text = await readFile(journalPath(process.cwd()), 'utf8');
      } catch {
        process.stdout.write('No journal yet.\n');
        return 0;
      }
      process.stdout.write(formatAskDigest(summarizeAsks(parseJournal(text))));
      return 0;
    }
    case 'verify-journal': {
      let text: string;
      try {
        text = await readFile(journalPath(process.cwd()), 'utf8');
      } catch {
        process.stdout.write('No journal yet — nothing to verify.\n');
        return 0;
      }
      const result = verifyJournalChain(parseJournal(text));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) {
        process.stderr.write(`⚠ journal chain broken at entry ${result.brokenAtIndex}: ${result.reason}\n`);
      }
      return result.ok ? 0 : 1;
    }
    case 'lease': {
      const [sub, ...leaseRest] = rest;
      if (sub === 'grant') {
        const json = leaseRest[0];
        if (json === undefined) {
          process.stderr.write(
            'usage: ideal-harness-guard lease grant \'{"tool":"Bash","match":"^npm test","reason":"...","minutes":30,"maxCalls":5}\'\n',
          );
          return 1;
        }
        const input = JSON.parse(json);
        if (typeof input.tool !== 'string' || typeof input.match !== 'string' || typeof input.reason !== 'string') {
          process.stderr.write('lease grant requires string "tool", "match", and "reason"\n');
          return 1;
        }
        const lease = grantLease(input, process.cwd());
        process.stdout.write(`${JSON.stringify(lease, null, 2)}\n`);
        return 0;
      }
      if (sub === 'list') {
        const now = Date.now();
        const leases = loadLeases(process.cwd());
        if (leases.length === 0) {
          process.stdout.write('No leases.\n');
          return 0;
        }
        for (const lease of leases as CapabilityLease[]) {
          const live = isLeaseLive(lease, now);
          process.stdout.write(`${live ? 'LIVE   ' : 'EXPIRED'} ${lease.id} — ${lease.reason}\n`);
        }
        return 0;
      }
      if (sub === 'revoke') {
        const id = leaseRest[0];
        if (id === undefined) {
          process.stderr.write('usage: ideal-harness-guard lease revoke <id>\n');
          return 1;
        }
        const revoked = revokeLease(id, process.cwd());
        process.stdout.write(revoked ? `revoked ${id}\n` : `no such lease: ${id}\n`);
        return revoked ? 0 : 1;
      }
      process.stderr.write('usage: ideal-harness-guard lease <grant|list|revoke>\n');
      return 1;
    }
    default:
      process.stdout.write(
        'usage: ideal-harness-guard <mcp|vet|policy|redact|learn|ratify|asks|verify-journal|lease>\n',
      );
      return command === undefined ? 1 : 0;
  }
}

runCli('ideal-harness-guard', main);
