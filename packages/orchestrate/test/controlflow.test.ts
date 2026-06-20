import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCheckpoint, resumeFrom, serializeCheckpoint } from '../src/checkpoint.js';
import { TaskLedger } from '../src/ledger.js';
import { LoopGuard } from '../src/loopguard.js';
import { ToolRegistry } from '../src/registry.js';
import { buildOrchestrateTools } from '../src/runtime/mcp.js';
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

test('parse() repairs a task with a missing status so it stays reachable', () => {
  const restored = TaskLedger.parse('{"counter":1,"tasks":[{"id":"t1","title":"orphan"}]}');
  const next = restored.nextPending();
  assert.equal(next?.id, 't1', 'a status-less task must not become permanently stuck');
  assert.equal(next?.status, 'pending');
});

test('parse() advances the counter past existing ids to prevent collisions', () => {
  const restored = TaskLedger.parse('{"tasks":[{"id":"t5","title":"five","status":"done"}]}');
  assert.equal(restored.add('six').id, 't6');
});

test('all() returns a copy — callers cannot structurally mutate the ledger', () => {
  const ledger = new TaskLedger();
  ledger.add('one');
  (ledger.all() as { length: number }).length = 0; // attempt to clear via the returned array
  assert.equal(ledger.all().length, 1);
});

test('LoopGuard rejects a non-positive threshold', () => {
  assert.throws(() => new LoopGuard(0), RangeError);
  assert.throws(() => new LoopGuard(-1), RangeError);
});

test('SpendGovernor rejects a NaN/negative cap instead of silently disabling it', () => {
  assert.throws(() => new SpendGovernor(Number('not-a-number')), /invalid spend cap/);
  assert.throws(() => new SpendGovernor(-100), /invalid spend cap/);
});

test('ledger_add surfaces a persist failure instead of falsely reporting success', async () => {
  const tools = buildOrchestrateTools(new TaskLedger(), new LoopGuard(), new SpendGovernor(), () => ({
    ok: false,
    error: 'disk full',
  }));
  const add = tools.find((t) => t.name === 'ledger_add');
  assert.ok(add);
  const res = await add.handler({ title: 'x' });
  assert.equal(res.isError, true);
  assert.match(res.text, /not persisted: disk full/);
});

test('ledger_add reports clean success when persistence succeeds', async () => {
  const tools = buildOrchestrateTools(new TaskLedger(), new LoopGuard(), new SpendGovernor(), () => ({ ok: true }));
  const add = tools.find((t) => t.name === 'ledger_add');
  assert.ok(add);
  const res = await add.handler({ title: 'x' });
  assert.notEqual(res.isError, true);
  assert.match(res.text, /"title":"x"/);
});

test('parseCheckpoint rejects a non-JSON embedded ledger up front', () => {
  assert.throws(
    () => parseCheckpoint(JSON.stringify({ phase: 'x', ledger: 'not json', ts: 1 })),
    /ledger is not valid JSON/,
  );
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
