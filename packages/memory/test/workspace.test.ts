import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EpisodicStore, filterByWorkspace } from '../src/episodic/store.js';
import { bindWorkspace, deriveWorkspaceKey, findWorkspaceRoot, normalizeGitRemote } from '../src/workspace.js';

test('git remotes normalize to the same identity across scp/https forms', () => {
  const https = normalizeGitRemote('https://github.com/Owner/Repo.git');
  const scp = normalizeGitRemote('git@github.com:Owner/Repo.git');
  assert.equal(https, scp);
  assert.equal(https, 'github.com/owner/repo');
});

test('ssh:// remotes with an embedded user normalize to the same identity as scp/https', () => {
  const https = normalizeGitRemote('https://github.com/Owner/Repo.git');
  const ssh = normalizeGitRemote('ssh://git@github.com/Owner/Repo.git');
  assert.equal(ssh, https, 'ssh://git@host/… must not split a repo into a second namespace');
  assert.equal(ssh, 'github.com/owner/repo');
});

test('workspace key prefers git identity, else a deterministic path hash', () => {
  const a = deriveWorkspaceKey({ gitRemote: 'git@github.com:o/r.git', root: '/x/y' });
  assert.equal(a, 'git:github.com/o/r');
  const b1 = deriveWorkspaceKey({ root: '/abs/project' });
  const b2 = deriveWorkspaceKey({ root: '/abs/project' });
  assert.match(b1, /^path:[0-9a-f]{16}$/);
  assert.equal(b1, b2, 'path key must be deterministic');
  assert.notEqual(b1, deriveWorkspaceKey({ root: '/abs/other' }));
});

test('findWorkspaceRoot walks up to the marker and returns null when absent', () => {
  const roots = new Set(['/a/b']); // /a/b is the project root
  const found = findWorkspaceRoot('/a/b/c/d', (dir) => roots.has(dir));
  assert.equal(found, '/a/b');
  assert.equal(
    findWorkspaceRoot('/a/b/c/d', () => false),
    null,
  );
});

test('bindWorkspace fails closed to ephemeral when unresolved or disabled', () => {
  const ephem = bindWorkspace({ root: null });
  assert.equal(ephem.persistent, false);
  assert.equal(ephem.storeDir, null);
  assert.equal(bindWorkspace({ root: '/p', enabled: false }).persistent, false);

  const bound = bindWorkspace({ root: '/p', gitRemote: 'git@github.com:o/r.git' });
  assert.equal(bound.persistent, true);
  assert.equal(bound.key, 'git:github.com/o/r');
  assert.match(bound.storeDir ?? '', /[/\\]\.ideal-harness[/\\]memory$/);
});

test('records are stamped per workspace and never cross the boundary', () => {
  const a = new EpisodicStore('git:proj-a');
  const b = new EpisodicStore('git:proj-b');
  a.add({ type: 'decision', text: 'A chose postgres', ts: 1 });
  b.add({ type: 'decision', text: 'B chose mysql', ts: 1 });
  assert.equal(a.all()[0]?.workspace, 'git:proj-a');

  // Simulate a misplaced/merged store: filtering keeps only the bound workspace.
  const merged = [...a.all(), ...b.all()];
  const onlyA = filterByWorkspace(merged, 'git:proj-a');
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0]?.text, 'A chose postgres');
});
