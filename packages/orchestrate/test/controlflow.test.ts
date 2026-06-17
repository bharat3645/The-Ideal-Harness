import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCheckpoint, resumeFrom, serializeCheckpoint } from '../src/checkpoint.js';
import { TaskLedger } from '../src/ledger.js';
import { LoopGuard } from '../src/loopguard.js';
import { ToolRegistry } from '../src/registry.js';
import { SpendGovernor } from '../src/spend.js';

test('ledger tracks progress and serializes/parses durably', () => {
  const ledger = new TaskLedger();
  const a = ledger.add('build core');
  ledger.add('build guard');
  ledger.update(a.id, { status: 'done', artifact: 'packages/core' });
  assert.deepEqual(ledger.progress(), { done: 1, total: 2 });

  const restored = TaskLedger.parse(ledger.serialize());
  assert.deepEqual(restored.progress(), { done: 1, total: 2 });
  assert.equal(restored.nextPending()?.title, 'build guard');
});

test('tool registry rejects duplicate registration', () => {
  const reg = new ToolRegistry();
  assert.equal(reg.register({ name: 'x', description: 'd' }).ok, true);
  assert.equal(reg.register({ name: 'x', description: 'again' }).ok, false);
  assert.equal(reg.list().length, 1);
});

test('loop guard flags a stall after the threshold of identical actions', () => {
  const guard = new LoopGuard(3);
  assert.equal(guard.record('act-A').stalled, false);
  assert.equal(guard.record('act-A').stalled, false);
  assert.equal(guard.record('act-A').stalled, true);
  assert.equal(guard.record('act-B').stalled, false); // different action resets
});

test('spend governor blocks a spend that would exceed the cap', () => {
  const spend = new SpendGovernor(1000);
  spend.record(800);
  assert.equal(spend.check(100).allowed, true);
  assert.equal(spend.check(300).allowed, false);
  assert.equal(spend.remaining(), 200);
});

test('null spend cap means unmetered', () => {
  const spend = new SpendGovernor(null);
  spend.record(1_000_000);
  assert.equal(spend.check(1_000_000).allowed, true);
  assert.equal(spend.remaining(), Number.POSITIVE_INFINITY);
});

test('checkpoint round-trips and resumes at the next pending task', () => {
  const ledger = new TaskLedger();
  const a = ledger.add('task one');
  ledger.add('task two');
  ledger.update(a.id, { status: 'done' });
  const checkpoint = { phase: 'execute', ledger: ledger.serialize(), ts: 123 };
  const resumed = resumeFrom(parseCheckpoint(serializeCheckpoint(checkpoint)));
  assert.equal(resumed.phase, 'execute');
  assert.equal(resumed.nextTaskId, 't2');
  assert.deepEqual(resumed.progress, { done: 1, total: 2 });
});
