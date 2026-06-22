#!/usr/bin/env node
/**
 * ideal-harness — substrate CLI dispatcher.
 *
 * Commands:
 *   validate [root]                       validate manifests + skill frontmatter
 *   gen-hosts <template> <outDir> [...]   render per-host SKILL.md files
 */

import { runGenHosts } from './gen-hosts.js';
import { runCli } from './runtime.js';
import { runValidate } from './validate.js';

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case 'validate':
      return runValidate(rest[0] ?? process.cwd());
    case 'gen-hosts':
      return runGenHosts(rest);
    case undefined:
    case '--help':
    case '-h':
      process.stdout.write('usage: ideal-harness <validate|gen-hosts> [args]\n');
      return command === undefined ? 1 : 0;
    default:
      process.stderr.write(`unknown command: ${command}\n`);
      return 1;
  }
}

runCli('ideal-harness', main);
