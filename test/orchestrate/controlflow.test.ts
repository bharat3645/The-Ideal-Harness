import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCheckpoint, resumeFrom, serializeCheckpoint } from '../../src/orchestrate/checkpoint.js';
import { isTaskVerify, TaskLedger } from '../../src/orchestrate/ledger.js';
import { LoopGuard } from '../../src/orchestrate/loopguard.js';
import { ToolRegistry } from '../../src/orchestrate/registry.js';
import { buildOrchestrateTools } from '../../src/orchestrate/runtime/mcp.js';
import { SpendGovernor } from '../../src/orchestrate/spend.js';

test('ledger tracks progress and serializes/parses durably', () => {
  const ledger = new TaskLedger();
  const a = ledger.add('build core');
  ledger.add('build guard');
  ledger.update(a.id, { status: 'done', artifact: 'src/core' });
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

test('SpendGovernor rejects a non-finite per-call spend instead of poisoning the total', () => {
  const spend = new SpendGovernor(1000);
  assert.equal(spend.check(Number('abc')).allowed, false, 'NaN spend must never be allowed');
  assert.throws(() => spend.record(Number('abc')), /invalid spend/);
  assert.throws(() => spend.record(Number.POSITIVE_INFINITY), /invalid spend/);
  // The cap must still work after a rejected garbage spend.
  spend.record(900);
  assert.equal(spend.check(200).allowed, false);
  assert.equal(spend.remaining(), 100);
});

test('spend_check rejects a non-numeric token count without disabling the cap', async () => {
  const spend = new SpendGovernor(1000);
  const tools = buildOrchestrateTools(new TaskLedger(), new LoopGuard(), spend);
  const check = tools.find((t) => t.name === 'spend_check');
  assert.ok(check);
  const bad = await check.handler({ tokens: 'abc' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /invalid token count/);
  assert.equal(spend.spent(), 0, 'a garbage spend must not be recorded');
  // A valid spend afterwards is still gated normally.
  const ok = await check.handler({ tokens: 999 });
  assert.notEqual(ok.isError, true);
  const blocked = await check.handler({ tokens: 2 });
  assert.match(blocked.text, /"allowed":false/);
});

test('ledger_update rejects an unknown status instead of stranding the task', async () => {
  const ledger = new TaskLedger();
  const task = ledger.add('do work');
  const tools = buildOrchestrateTools(ledger, new LoopGuard(), new SpendGovernor());
  const update = tools.find((t) => t.name === 'ledger_update');
  assert.ok(update);
  const res = await update.handler({ id: task.id, status: 'blocked' });
  assert.equal(res.isError, true);
  assert.match(res.text, /invalid status/);
  // The task keeps its valid status and stays reachable to nextPending().
  assert.equal(ledger.get(task.id)?.status, 'pending');
  assert.equal(ledger.nextPending()?.id, task.id);
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

test('isTaskVerify validates the {command, expect?} shape', () => {
  assert.equal(isTaskVerify({ command: 'pnpm test' }), true);
  assert.equal(isTaskVerify({ command: 'pnpm test', expect: 'all pass' }), true);
  assert.equal(isTaskVerify({ expect: 'no command' }), false);
  assert.equal(isTaskVerify({ command: 123 }), false);
  assert.equal(isTaskVerify(null), false);
  assert.equal(isTaskVerify('pnpm test'), false);
});

test('add() carries an optional verify step, and it survives serialize/parse', () => {
  const ledger = new TaskLedger();
  const task = ledger.add('build the thing', undefined, { command: 'pnpm test', expect: 'all green' });
  assert.deepEqual(task.verify, { command: 'pnpm test', expect: 'all green' });

  const restored = TaskLedger.parse(ledger.serialize());
  assert.deepEqual(restored.get(task.id)?.verify, { command: 'pnpm test', expect: 'all green' });
});

test('parse() drops a malformed verify field instead of failing the whole task', () => {
  const restored = TaskLedger.parse(
    JSON.stringify({ tasks: [{ id: 't1', title: 'x', status: 'pending', verify: { expect: 'no command field' } }] }),
  );
  assert.equal(restored.get('t1')?.verify, undefined);
  assert.equal(restored.get('t1')?.title, 'x', 'the rest of the task must still load');
});

test('update() can attach a verify step to an existing task', () => {
  const ledger = new TaskLedger();
  const task = ledger.add('build the thing');
  assert.equal(task.verify, undefined);
  const updated = ledger.update(task.id, { verify: { command: 'node check.js' } });
  assert.deepEqual(updated.verify, { command: 'node check.js' });
});

test('ledger_add rejects a malformed verify instead of silently dropping it', async () => {
  const tools = buildOrchestrateTools(new TaskLedger(), new LoopGuard(), new SpendGovernor());
  const add = tools.find((t) => t.name === 'ledger_add');
  assert.ok(add);
  const res = await add.handler({ title: 'x', verify: { expect: 'missing command' } });
  assert.equal(res.isError, true);
  assert.match(res.text, /invalid verify/);
});

test('ledger_add accepts a well-formed verify and it lands on the created task', async () => {
  const ledger = new TaskLedger();
  const tools = buildOrchestrateTools(ledger, new LoopGuard(), new SpendGovernor());
  const add = tools.find((t) => t.name === 'ledger_add');
  assert.ok(add);
  const res = await add.handler({ title: 'x', verify: { command: 'pnpm test' } });
  assert.notEqual(res.isError, true);
  assert.match(res.text, /"command":"pnpm test"/);
});

test('ledger_verify errors on an unknown task id', async () => {
  const tools = buildOrchestrateTools(new TaskLedger(), new LoopGuard(), new SpendGovernor());
  const verify = tools.find((t) => t.name === 'ledger_verify');
  assert.ok(verify);
  const res = await verify.handler({ id: 'no-such-task' });
  assert.equal(res.isError, true);
});

test('ledger_verify errors when the task has no verify.command', async () => {
  const ledger = new TaskLedger();
  const task = ledger.add('no verify set');
  const tools = buildOrchestrateTools(ledger, new LoopGuard(), new SpendGovernor());
  const verify = tools.find((t) => t.name === 'ledger_verify');
  assert.ok(verify);
  const res = await verify.handler({ id: task.id });
  assert.equal(res.isError, true);
  assert.match(res.text, /no verify\.command/);
});

test('ledger_verify leaves task status untouched when policy refuses to run it', async () => {
  const ledger = new TaskLedger();
  // An arbitrary Bash command has no default allow rule, so the default floor asks.
  const task = ledger.add('risky task', undefined, { command: 'node -e "console.log(1)"' });
  const tools = buildOrchestrateTools(ledger, new LoopGuard(), new SpendGovernor());
  const verify = tools.find((t) => t.name === 'ledger_verify');
  assert.ok(verify);
  const res = await verify.handler({ id: task.id });
  assert.notEqual(res.isError, true);
  assert.match(res.text, /blocked/);
  assert.equal(ledger.get(task.id)?.status, 'pending', 'status must not change when the command never ran');
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
