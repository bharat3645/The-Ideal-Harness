#!/usr/bin/env node
/**
 * SessionStart hook — inject the `using-ideal-harness` bootstrap skill into context.
 *
 * Emits the bootstrap skill body as `additionalContext` so the agent knows the
 * harness is active and how to route, without the user having to invoke it.
 * Fails open (empty output) if the skill file is missing — a broken hook must
 * never block a session from starting.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = join(here, '..', 'skills', 'using-ideal-harness', 'SKILL.md');

async function main() {
  let context = '';
  try {
    const raw = await readFile(skillPath, 'utf8');
    // Strip the frontmatter fence; inject the body only.
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    context = `The Ideal Harness is active.\n\n${body}`;
  } catch {
    // Fail open: no bootstrap context rather than a broken session.
  }
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch(() => {
  // Never throw from a session-start hook.
  process.stdout.write('{}');
});
