import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { consolidate } from '../../src/memory/episodic/consolidate.js';
import { episodicSnapshotPath, loadEpisodicSnapshot, saveEpisodicSnapshot } from '../../src/memory/episodic/persist.js';
import { EpisodicStore } from '../../src/memory/episodic/store.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ideal-harness-episodic-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('EpisodicStore.serialize/parse round-trips observations', () => {
  const store = new EpisodicStore('proj');
  store.add({ type: 'decision', text: 'chose postgres', ts: 1 });
  store.add({ type: 'failure', text: 'tried mysql, dropped it', ts: 2 });
  const restored = EpisodicStore.parse(store.serialize(), 'proj');
  assert.deepEqual(
    restored.all().map((o) => o.text),
    ['chose postgres', 'tried mysql, dropped it'],
  );
});

test('EpisodicStore.parse drops entries from a foreign workspace', () => {
  const store = new EpisodicStore('proj-a');
  store.add({ type: 'note', text: 'a note', ts: 1 });
  const restored = EpisodicStore.parse(store.serialize(), 'proj-b');
  assert.deepEqual(restored.all(), []);
});

test('EpisodicStore.parse throws on invalid JSON (callers quarantine)', () => {
  assert.throws(() => EpisodicStore.parse('not json'));
});

test('EpisodicStore.parse tolerates individual corrupt entries', () => {
  const json = JSON.stringify({
    workspace: 'proj',
    observations: [
      { id: 'obs-1', workspace: 'proj' /* missing ts/type/text */ },
      { id: 'obs-2', ts: 1, type: 'note', text: 'ok', workspace: 'proj' },
    ],
  });
  const restored = EpisodicStore.parse(json, 'proj');
  assert.deepEqual(
    restored.all().map((o) => o.id),
    ['obs-2'],
  );
});

test('saveEpisodicSnapshot + loadEpisodicSnapshot round-trip through the filesystem', () => {
  withTmpDir((dir) => {
    const store = new EpisodicStore('proj');
    store.add({ type: 'decision', text: 'use bm25 not embeddings', ts: 1 });
    assert.equal(saveEpisodicSnapshot(store, dir), true);
    assert.ok(existsSync(episodicSnapshotPath(dir)));
    const loaded = loadEpisodicSnapshot(dir, 'proj');
    assert.deepEqual(
      loaded.all().map((o) => o.text),
      ['use bm25 not embeddings'],
    );
  });
});

test('loadEpisodicSnapshot returns an empty store when no snapshot exists yet', () => {
  withTmpDir((dir) => {
    assert.deepEqual(loadEpisodicSnapshot(dir).all(), []);
  });
});

test('loadEpisodicSnapshot quarantines a corrupt snapshot instead of crashing', () => {
  withTmpDir((dir) => {
    const path = episodicSnapshotPath(dir);
    writeFileSync(path, '{not valid json', 'utf8');
    const store = loadEpisodicSnapshot(dir);
    assert.deepEqual(store.all(), []);
    assert.ok(existsSync(`${path}.corrupt`));
    assert.equal(existsSync(path), false);
  });
});

test('consolidate dedupes near-identical text, keeping the newer record', () => {
  const kept = consolidate([
    { id: 'obs-1', ts: 1, type: 'note', text: 'the cache expires after sixty seconds' },
    { id: 'obs-2', ts: 2, type: 'note', text: 'the cache expires after sixty seconds exactly' },
  ]).kept;
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.id, 'obs-2');
});

test('consolidate never dedupes across different observation types', () => {
  const result = consolidate([
    { id: 'obs-1', ts: 1, type: 'decision', text: 'chose postgres for billing' },
    { id: 'obs-2', ts: 2, type: 'failure', text: 'chose postgres for billing' },
  ]);
  assert.equal(result.kept.length, 2);
  assert.equal(result.dedupedCount, 0);
});

test('consolidate prunes low-signal records past maxCount, oldest note/bugfix/feature first', () => {
  const observations = [
    { id: 'obs-1', ts: 1, type: 'note' as const, text: 'note one is old and low signal' },
    { id: 'obs-2', ts: 2, type: 'note' as const, text: 'note two also low signal today' },
    { id: 'obs-3', ts: 3, type: 'decision' as const, text: 'permanent decision record here' },
  ];
  const result = consolidate(observations, { maxCount: 2 });
  assert.equal(result.kept.length, 2);
  assert.ok(
    result.kept.some((o) => o.type === 'decision'),
    'decision must survive pruning',
  );
  assert.equal(result.prunedCount, 1);
});

test('consolidate never prunes decision, failure, or security_alert records', () => {
  const observations = [
    { id: 'obs-1', ts: 1, type: 'decision' as const, text: 'decision one' },
    { id: 'obs-2', ts: 2, type: 'failure' as const, text: 'failure one' },
    { id: 'obs-3', ts: 3, type: 'security_alert' as const, text: 'alert one' },
  ];
  const result = consolidate(observations, { maxCount: 0 });
  assert.equal(result.kept.length, 3, 'all three permanent types survive even under a zero budget');
});
