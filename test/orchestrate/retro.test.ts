import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LedgerTask } from '../../src/orchestrate/ledger.js';
import { generateRetro } from '../../src/orchestrate/retro.js';

const NOW = Date.UTC(2026, 7, 10);

test('generateRetro summarizes counts and verify coverage', () => {
  const tasks: LedgerTask[] = [
    { id: 't1', title: 'build core', status: 'done', verify: { command: 'pnpm build' } },
    { id: 't2', title: 'write docs', status: 'done' },
    { id: 't3', title: 'flaky task', status: 'failed', notes: 'timed out' },
    { id: 't4', title: 'not started', status: 'pending' },
  ];
  const md = generateRetro(tasks, { now: NOW });
  assert.match(md, /Total tasks: 4/);
  assert.match(md, /Done: 2/);
  assert.match(md, /Failed: 1/);
  assert.match(md, /Pending\/in-progress: 1/);
  assert.match(md, /Done tasks verified by a real command: 1\/2/);
  assert.match(md, /Done tasks marked done WITHOUT a verify command \(asserted, not measured\): 1/);
});

test('generateRetro calls out failed and unverified-done tasks by id', () => {
  const tasks: LedgerTask[] = [
    { id: 't1', title: 'risky task', status: 'failed', notes: 'boom' },
    { id: 't2', title: 'trust me task', status: 'done' },
  ];
  const md = generateRetro(tasks, { now: NOW });
  assert.match(md, /## Failed tasks/);
  assert.match(md, /risky task/);
  assert.match(md, /## Done without verification/);
  assert.match(md, /trust me task/);
});

test('generateRetro handles an empty ledger without dividing by zero', () => {
  const md = generateRetro([], { now: NOW });
  assert.match(md, /Total tasks: 0/);
  assert.match(md, /n\/a/);
});
