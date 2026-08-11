import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createWorktree,
  isValidWorktreeId,
  listWorktrees,
  removeWorktree,
  worktreesRoot,
} from '../../src/orchestrate/worktree.js';

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ih-worktree-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'hello');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

test('isValidWorktreeId rejects path-traversal-shaped and empty ids', () => {
  assert.equal(isValidWorktreeId('task-1'), true);
  assert.equal(isValidWorktreeId('../escape'), false);
  assert.equal(isValidWorktreeId('a/b'), false);
  assert.equal(isValidWorktreeId('a\\b'), false);
  assert.equal(isValidWorktreeId(''), false);
  assert.equal(isValidWorktreeId('x'.repeat(81)), false);
});

test('createWorktree refuses an invalid id without touching git', async () => {
  const dir = initRepo();
  try {
    const result = await createWorktree('../escape', { cwd: dir });
    assert.equal(result.ok, false);
    assert.match(result.stderr, /invalid worktree id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createWorktree + listWorktrees + removeWorktree round-trip through real git', async () => {
  const dir = initRepo();
  try {
    const created = await createWorktree('task-1', { cwd: dir });
    assert.equal(created.ok, true, created.stderr);
    assert.equal(created.info?.id, 'task-1');
    assert.ok(existsSync(join(worktreesRoot(dir), 'task-1')));

    const listed = await listWorktrees(dir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, 'task-1');
    assert.equal(listed[0]?.branch, 'ideal-harness/task-1');

    const removed = await removeWorktree('task-1', { cwd: dir });
    assert.equal(removed.ok, true, removed.stderr);
    assert.equal(existsSync(join(worktreesRoot(dir), 'task-1')), false);
    assert.equal((await listWorktrees(dir)).length, 0);

    // deleteBranch defaults true: the branch should be gone too.
    const branches = execFileSync('git', ['branch', '--list', 'ideal-harness/task-1'], { cwd: dir }).toString();
    assert.equal(branches.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two concurrently created worktrees do not collide', async () => {
  const dir = initRepo();
  try {
    const [a, b] = await Promise.all([createWorktree('task-a', { cwd: dir }), createWorktree('task-b', { cwd: dir })]);
    assert.equal(a.ok, true, a.stderr);
    assert.equal(b.ok, true, b.stderr);
    const listed = await listWorktrees(dir);
    assert.equal(listed.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listWorktrees excludes the primary checkout, only reporting ones under .ideal-harness/worktrees', async () => {
  const dir = initRepo();
  try {
    assert.deepEqual(await listWorktrees(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
