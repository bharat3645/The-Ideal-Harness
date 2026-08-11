#!/usr/bin/env node
/**
 * ideal-harness-web — web CLI.
 *
 * Commands:
 *   mcp                start the web MCP server (stdio)
 *   fetch <url>         fetch a URL and print extracted text
 *   docs <package>      print a package's live npm registry metadata/README
 */

import { runCli } from '../../core/index.js';
import { fetchPackageDocs } from '../docs.js';
import { fetchPage } from '../fetch.js';
import { startWebMcp } from '../runtime/mcp.js';

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case 'mcp':
      await startWebMcp();
      return 0;
    case 'fetch': {
      const url = rest[0];
      if (url === undefined) {
        process.stderr.write('usage: ideal-harness-web fetch <url>\n');
        return 1;
      }
      const result = await fetchPage(url);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    case 'docs': {
      const name = rest[0];
      if (name === undefined) {
        process.stderr.write('usage: ideal-harness-web docs <package>\n');
        return 1;
      }
      const result = await fetchPackageDocs(name);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    default:
      process.stdout.write('usage: ideal-harness-web <mcp|fetch|docs>\n');
      return command === undefined ? 1 : 0;
  }
}

runCli('ideal-harness-web', main);
