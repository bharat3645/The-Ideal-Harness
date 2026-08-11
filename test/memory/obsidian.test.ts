import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportToVault, importFromVault } from '../../src/memory/bridge/obsidian.js';
import type { Observation } from '../../src/memory/episodic/store.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ih-vault-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const OBS: Observation = { id: 'obs-1', ts: 1700000000000, type: 'decision', text: 'chose bm25 over embeddings' };

test('exportToVault writes one Markdown note per observation with frontmatter', () => {
  withTmpDir((vaultDir) => {
    const result = exportToVault([OBS], { vaultDir });
    assert.equal(result.written, 1);
    assert.equal(result.unchanged, 0);
    const content = readFileSync(result.files[0] as string, 'utf8');
    assert.match(content, /^---/);
    assert.match(content, /id: obs-1/);
    assert.match(content, /type: decision/);
    assert.match(content, /chose bm25 over embeddings/);
  });
});

test('exportToVault is idempotent — re-exporting unchanged content does not rewrite', () => {
  withTmpDir((vaultDir) => {
    exportToVault([OBS], { vaultDir });
    const second = exportToVault([OBS], { vaultDir });
    assert.equal(second.written, 0);
    assert.equal(second.unchanged, 1);
  });
});

test('exportToVault writes into a custom folder name', () => {
  withTmpDir((vaultDir) => {
    exportToVault([OBS], { vaultDir, folder: 'my-notes' });
    const files = readdirSync(join(vaultDir, 'my-notes'));
    assert.equal(files.length, 1);
  });
});

test('importFromVault round-trips what exportToVault wrote', () => {
  withTmpDir((vaultDir) => {
    exportToVault([OBS], { vaultDir });
    const { candidates, skipped } = importFromVault({ vaultDir });
    assert.equal(candidates.length, 1);
    assert.equal(skipped.length, 0);
    assert.equal(candidates[0]?.observation.id, 'obs-1');
    assert.equal(candidates[0]?.observation.type, 'decision');
    assert.equal(candidates[0]?.observation.text, 'chose bm25 over embeddings');
  });
});

test('importFromVault returns empty (not an error) when the vault folder does not exist yet', () => {
  withTmpDir((vaultDir) => {
    const result = importFromVault({ vaultDir: join(vaultDir, 'nonexistent') });
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.skipped, []);
  });
});

test('importFromVault skips human-authored notes that lack our frontmatter fields, without erroring', () => {
  withTmpDir((vaultDir) => {
    const dir = join(vaultDir, 'ideal-harness');
    exportToVault([OBS], { vaultDir }); // creates the folder
    writeFileSync(join(dir, 'my-own-note.md'), '# Just a note\n\nNo frontmatter at all.\n', 'utf8');
    writeFileSync(join(dir, 'partial.md'), '---\ntitle: something else\n---\n\nbody\n', 'utf8');
    const { candidates, skipped } = importFromVault({ vaultDir });
    assert.equal(candidates.length, 1); // only the one exported by us
    assert.equal(skipped.length, 2);
  });
});

test('importFromVault never writes anything — it only ever reads', () => {
  withTmpDir((vaultDir) => {
    exportToVault([OBS], { vaultDir });
    const before = readdirSync(join(vaultDir, 'ideal-harness')).length;
    importFromVault({ vaultDir });
    const after = readdirSync(join(vaultDir, 'ideal-harness')).length;
    assert.equal(before, after);
  });
});
