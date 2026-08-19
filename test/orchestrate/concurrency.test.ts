/**
 * Real concurrent-writer tests for issue #17 / decisions.md D039: two
 * independent `buildOrchestrateTools` instances (simulating two separate MCP
 * server processes on the same workspace) sharing the same lock-protected
 * `LedgerIo`/`SpendIo` backed by real files, proving neither writer's update
 * is silently lost — the exact scenario the issue's own text describes ("a
 * task marked done by process A is overwritten back to pending by process
 * B's next persist").
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockPathFor } from '../../src/core/index.js';
import { TaskLedger } from '../../src/orchestrate/ledger.js';
import { LoopGuard } from '../../src/orchestrate/loopguard.js';
import { buildOrchestrateTools, type LedgerIo, type SpendIo } from '../../src/orchestrate/runtime/mcp.js';
import { SpendGovernor } from '../../src/orchestrate/spend.js';

async function withTmpDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ideal-harness-orch-concurrency-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeLedgerIo(ledgerPath: string): LedgerIo {
  return {
    load: () => {
      if (!existsSync(ledgerPath)) {
        return new TaskLedger();
      }
      try {
        return TaskLedger.parse(readFileSync(ledgerPath, 'utf8'));
      } catch {
        return new TaskLedger();
      }
    },
    save: (l) => {
      try {
        writeFileSync(ledgerPath, l.serialize());
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    lockPath: lockPathFor(ledgerPath),
  };
}

function makeSpendIo(spendPath: string): SpendIo {
  return {
    load: () => {
      if (!existsSync(spendPath)) {
        return 0;
      }
      try {
        const data = JSON.parse(readFileSync(spendPath, 'utf8')) as { used?: number };
        return typeof data.used === 'number' ? data.used : 0;
      } catch {
        return 0;
      }
    },
    save: (used) => writeFileSync(spendPath, JSON.stringify({ used, ts: Date.now() })),
    lockPath: lockPathFor(spendPath),
  };
}

test('two concurrent processes each adding a DIFFERENT task lose neither (the vanishing-new-tasks case)', async () => {
  await withTmpDir(async (dir) => {
    const ledgerPath = join(dir, 'ledger.json');
    const io = makeLedgerIo(ledgerPath);
    // Two independent in-memory ledgers + tool sets sharing the same file/lock —
    // exactly what two separate MCP server processes on one workspace look like.
    const toolsA = buildOrchestrateTools(
      new TaskLedger(),
      new LoopGuard(),
      new SpendGovernor(),
      undefined,
      undefined,
      io,
    );
    const toolsB = buildOrchestrateTools(
      new TaskLedger(),
      new LoopGuard(),
      new SpendGovernor(),
      undefined,
      undefined,
      io,
    );
    const addA = toolsA.find((t) => t.name === 'ledger_add');
    const addB = toolsB.find((t) => t.name === 'ledger_add');
    assert.ok(addA && addB);

    const [resA, resB] = await Promise.all([addA.handler({ title: 'from A' }), addB.handler({ title: 'from B' })]);
    assert.notEqual(resA.isError, true);
    assert.notEqual(resB.isError, true);

    const final = TaskLedger.parse(readFileSync(ledgerPath, 'utf8'));
    assert.equal(final.all().length, 2, "both concurrently-added tasks must be present, not just the last writer's");
    assert.deepEqual(
      final
        .all()
        .map((t) => t.title)
        .sort(),
      ['from A', 'from B'],
    );
  });
});

test("a status update from one process is not clobbered by a concurrent process's stale-copy update to the SAME task (the issue's own headline scenario)", async () => {
  await withTmpDir(async (dir) => {
    const ledgerPath = join(dir, 'ledger.json');
    const io = makeLedgerIo(ledgerPath);
    const seed = new TaskLedger();
    const task = seed.add('shared task');
    writeFileSync(ledgerPath, seed.serialize());

    // Both processes load the SAME initial state (task still 'pending') before
    // either mutates anything — this is what makes process B's in-memory copy
    // "stale" relative to whatever A does next.
    const ledgerA = io.load();
    const ledgerB = io.load();
    const toolsA = buildOrchestrateTools(ledgerA, new LoopGuard(), new SpendGovernor(), undefined, undefined, io);
    const toolsB = buildOrchestrateTools(ledgerB, new LoopGuard(), new SpendGovernor(), undefined, undefined, io);
    const updateA = toolsA.find((t) => t.name === 'ledger_update');
    const updateB = toolsB.find((t) => t.name === 'ledger_update');
    assert.ok(updateA && updateB);

    // Process A marks the task done and persists...
    const resA = await updateA.handler({ id: task.id, status: 'done' });
    assert.notEqual(resA.isError, true);

    // ...then process B — still only knowing about the task's state from
    // BEFORE A's update — makes an unrelated edit (adding a note) and persists.
    // Pre-#17, B's persist would write its whole stale in-memory ledger back
    // out, silently reverting the task to 'pending'. Post-#17, B's mutation is
    // replayed against a fresh reload, not its stale copy.
    const resB = await updateB.handler({ id: task.id, notes: 'B noted something' });
    assert.notEqual(resB.isError, true);

    const final = TaskLedger.parse(readFileSync(ledgerPath, 'utf8'));
    const finalTask = final.get(task.id);
    assert.ok(finalTask);
    assert.equal(finalTask.status, 'done', "A's status update must survive B's later, unrelated update");
    assert.equal(finalTask.notes, 'B noted something', "B's own update must also land");
  });
});

test('two concurrent spend_check calls both count toward the persisted total (additive merge, no lost spend)', async () => {
  await withTmpDir(async (dir) => {
    const spendPath = join(dir, 'spend.json');
    const spendIo = makeSpendIo(spendPath);
    const toolsA = buildOrchestrateTools(
      new TaskLedger(),
      new LoopGuard(),
      new SpendGovernor(1000),
      undefined,
      undefined,
      undefined,
      spendIo,
    );
    const toolsB = buildOrchestrateTools(
      new TaskLedger(),
      new LoopGuard(),
      new SpendGovernor(1000),
      undefined,
      undefined,
      undefined,
      spendIo,
    );
    const checkA = toolsA.find((t) => t.name === 'spend_check');
    const checkB = toolsB.find((t) => t.name === 'spend_check');
    assert.ok(checkA && checkB);

    await Promise.all([checkA.handler({ tokens: 100 }), checkB.handler({ tokens: 50 })]);

    const final = JSON.parse(readFileSync(spendPath, 'utf8')) as { used: number };
    assert.equal(final.used, 150, 'both concurrent spends must be summed, neither silently dropped');
  });
});

test('spend_check denies a request that would exceed the cap once the cross-process total is accounted for', async () => {
  await withTmpDir(async (dir) => {
    const spendPath = join(dir, 'spend.json');
    const spendIo = makeSpendIo(spendPath);
    const toolsA = buildOrchestrateTools(
      new TaskLedger(),
      new LoopGuard(),
      new SpendGovernor(150),
      undefined,
      undefined,
      undefined,
      spendIo,
    );
    const toolsB = buildOrchestrateTools(
      new TaskLedger(),
      new LoopGuard(),
      new SpendGovernor(150),
      undefined,
      undefined,
      undefined,
      spendIo,
    );
    const checkA = toolsA.find((t) => t.name === 'spend_check');
    const checkB = toolsB.find((t) => t.name === 'spend_check');
    assert.ok(checkA && checkB);

    // A spends 100 first (cap 150), then B tries 100 more — sequential here
    // (not concurrent) specifically to prove the cap CHECK itself sees the
    // fresh cross-process total, not B's own stale "spent=0" view.
    await checkA.handler({ tokens: 100 });
    const resB = await checkB.handler({ tokens: 100 });
    const parsed = JSON.parse(resB.text) as { allowed: boolean };
    assert.equal(
      parsed.allowed,
      false,
      "B's check must see A's spend and correctly deny, not just check its own stale total",
    );

    const final = JSON.parse(readFileSync(spendPath, 'utf8')) as { used: number };
    assert.equal(final.used, 100, "B's denied spend must not have been recorded");
  });
});
