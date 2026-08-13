import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  appendJournalEntry,
  buildJournalEntry,
  chainHash,
  JOURNAL_ENV_VAR,
  JOURNAL_GENESIS_HASH,
  JOURNAL_MAX_ENTRIES_ENV_VAR,
  JOURNAL_SUBJECT_MAX,
  journalPath,
  parseJournal,
  verifyJournalChain,
} from '../../src/guard/journal.js';

const decision = { action: 'ask' as const, ruleId: 'ask-bash', reason: 'shell commands require approval' };

test('buildJournalEntry keeps the fields auditing needs', () => {
  const entry = buildJournalEntry({
    ts: '2026-07-07T00:00:00.000Z',
    tool: 'Bash',
    subject: 'npm test',
    decision,
    mode: 'soft',
  });
  assert.deepEqual(entry, {
    ts: '2026-07-07T00:00:00.000Z',
    tool: 'Bash',
    subject: 'npm test',
    action: 'ask',
    ruleId: 'ask-bash',
    mode: 'soft',
  });
});

test('buildJournalEntry redacts secrets in the subject — the journal must not leak', () => {
  const entry = buildJournalEntry({
    ts: 't',
    tool: 'Bash',
    subject: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwx" https://x.com',
    decision,
    mode: 'soft',
  });
  assert.ok(!entry.subject.includes('sk-ant-api03-abcdefghijklmnopqrstuvwx'), 'secret must be redacted');
});

test('buildJournalEntry truncates oversized subjects', () => {
  const entry = buildJournalEntry({ ts: 't', tool: 'Bash', subject: 'x'.repeat(1000), decision, mode: 'enforce' });
  assert.ok(entry.subject.length <= JOURNAL_SUBJECT_MAX + 1); // +1 for the ellipsis
});

test('appendJournalEntry writes one JSON line; parseJournal reads it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const entry = buildJournalEntry({ ts: 't', tool: 'Bash', subject: 'git status', decision, mode: 'soft' });
    assert.equal(appendJournalEntry(entry, { cwd: dir, env: {} }), true);
    assert.equal(appendJournalEntry(entry, { cwd: dir, env: {} }), true);
    const text = readFileSync(journalPath(dir), 'utf8');
    const parsed = parseJournal(text);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.subject, 'git status');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('kill-switch: IDEAL_HARNESS_JOURNAL=off skips writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const entry = buildJournalEntry({ ts: 't', tool: 'Bash', subject: 'ls', decision, mode: 'soft' });
    assert.equal(appendJournalEntry(entry, { cwd: dir, env: { [JOURNAL_ENV_VAR]: 'off' } }), false);
    assert.throws(() => readFileSync(journalPath(dir), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseJournal skips malformed lines instead of throwing', () => {
  const good = JSON.stringify(buildJournalEntry({ ts: 't', tool: 'Bash', subject: 'ls', decision, mode: 'soft' }));
  const parsed = parseJournal(`${good}\n{ broken\n\n${good}\n`);
  assert.equal(parsed.length, 2);
});

test('appendJournalEntry chains each entry to the previous one via prevHash/hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const e1 = buildJournalEntry({ ts: 't1', tool: 'Bash', subject: 'git status', decision, mode: 'soft' });
    const e2 = buildJournalEntry({ ts: 't2', tool: 'Bash', subject: 'git log', decision, mode: 'soft' });
    appendJournalEntry(e1, { cwd: dir, env: {} });
    appendJournalEntry(e2, { cwd: dir, env: {} });
    const [p1, p2] = parseJournal(readFileSync(journalPath(dir), 'utf8'));
    assert.equal(p1?.prevHash, JOURNAL_GENESIS_HASH);
    assert.ok(p1?.hash);
    assert.equal(p2?.prevHash, p1?.hash, "second entry links to the first entry's hash");
    assert.equal(chainHash(p1?.prevHash as string, p1 as never), p1?.hash, 'stored hash matches recomputation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyJournalChain reports ok:true over an untampered chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    for (const subject of ['a', 'b', 'c']) {
      appendJournalEntry(buildJournalEntry({ ts: 't', tool: 'Bash', subject, decision, mode: 'soft' }), {
        cwd: dir,
        env: {},
      });
    }
    const entries = parseJournal(readFileSync(journalPath(dir), 'utf8'));
    const result = verifyJournalChain(entries);
    assert.equal(result.ok, true);
    assert.equal(result.checked, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyJournalChain detects a tampered entry (content edited after the fact)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    for (const subject of ['a', 'b']) {
      appendJournalEntry(buildJournalEntry({ ts: 't', tool: 'Bash', subject, decision, mode: 'soft' }), {
        cwd: dir,
        env: {},
      });
    }
    const entries = parseJournal(readFileSync(journalPath(dir), 'utf8'));
    const tampered = entries.map((e, i) => (i === 0 ? { ...e, subject: 'rm -rf /' } : e));
    const result = verifyJournalChain(tampered);
    assert.equal(result.ok, false);
    assert.equal(result.brokenAtIndex, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyJournalChain detects a deleted entry (chain link broken)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    for (const subject of ['a', 'b', 'c']) {
      appendJournalEntry(buildJournalEntry({ ts: 't', tool: 'Bash', subject, decision, mode: 'soft' }), {
        cwd: dir,
        env: {},
      });
    }
    const entries = parseJournal(readFileSync(journalPath(dir), 'utf8'));
    const withDeletion = [entries[0], entries[2]].filter((e) => e !== undefined) as typeof entries;
    const result = verifyJournalChain(withDeletion);
    assert.equal(result.ok, false);
    assert.equal(result.brokenAtIndex, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyJournalChain treats pre-chain (hash-less) entries as unverifiable, not tampered', () => {
  const legacy = {
    ts: 't',
    tool: 'Bash',
    subject: 'ls',
    action: 'ask' as const,
    ruleId: 'ask-bash',
    mode: 'soft' as const,
  };
  const result = verifyJournalChain([legacy]);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
});

test('a corrupted trailing line does not block the next append (self-heals to a fresh chain segment)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const e1 = buildJournalEntry({ ts: 't1', tool: 'Bash', subject: 'git status', decision, mode: 'soft' });
    appendJournalEntry(e1, { cwd: dir, env: {} });
    appendFileSync(journalPath(dir), '{ not valid json\n', 'utf8');
    const e2 = buildJournalEntry({ ts: 't2', tool: 'Bash', subject: 'git log', decision, mode: 'soft' });
    assert.equal(appendJournalEntry(e2, { cwd: dir, env: {} }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotation: active journal is archived (renamed, not deleted) once it hits the max-entries threshold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const env = { [JOURNAL_MAX_ENTRIES_ENV_VAR]: '2' };
    for (const subject of ['a', 'b', 'c']) {
      appendJournalEntry(buildJournalEntry({ ts: 't', tool: 'Bash', subject, decision, mode: 'soft' }), {
        cwd: dir,
        env,
      });
    }
    const archivePath = journalPath(dir).replace(/\.jsonl$/, '.1.jsonl');
    assert.ok(existsSync(archivePath), 'the 2-entry file should have been archived before the 3rd append');
    const archived = parseJournal(readFileSync(archivePath, 'utf8'));
    assert.equal(archived.length, 2);
    assert.deepEqual(
      archived.map((e) => e.subject),
      ['a', 'b'],
    );

    const active = parseJournal(readFileSync(journalPath(dir), 'utf8'));
    assert.equal(active.length, 1, 'the active file should only hold what was written after rotation');
    assert.equal(active[0]?.subject, 'c');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotation: archive keeps its own hash chain fully verifiable, and the post-rotation active file starts a fresh chain from genesis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const env = { [JOURNAL_MAX_ENTRIES_ENV_VAR]: '2' };
    for (const subject of ['a', 'b', 'c']) {
      appendJournalEntry(buildJournalEntry({ ts: 't', tool: 'Bash', subject, decision, mode: 'soft' }), {
        cwd: dir,
        env,
      });
    }
    const archivePath = journalPath(dir).replace(/\.jsonl$/, '.1.jsonl');
    const archived = parseJournal(readFileSync(archivePath, 'utf8'));
    assert.equal(verifyJournalChain(archived).ok, true, 'archived chain must still verify on its own');

    const active = parseJournal(readFileSync(journalPath(dir), 'utf8'));
    assert.equal(
      active[0]?.prevHash,
      JOURNAL_GENESIS_HASH,
      'active file restarts the chain, it does not link back to the archive',
    );
    assert.equal(verifyJournalChain(active).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotation: repeated rotations pick increasing archive numbers instead of colliding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const env = { [JOURNAL_MAX_ENTRIES_ENV_VAR]: '1' };
    for (const subject of ['a', 'b', 'c']) {
      appendJournalEntry(buildJournalEntry({ ts: 't', tool: 'Bash', subject, decision, mode: 'soft' }), {
        cwd: dir,
        env,
      });
    }
    const names = readdirSync(dirname(journalPath(dir))).filter(
      (f) => f.startsWith('guard-journal') && f.endsWith('.jsonl'),
    );
    assert.ok(names.includes('guard-journal.1.jsonl'));
    assert.ok(names.includes('guard-journal.2.jsonl'));
    assert.ok(names.includes('guard-journal.jsonl'), 'active file still present with the last entry');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotation: threshold 0 (or negative) disables rotation — the file grows unbounded as before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ih-journal-'));
  try {
    const env = { [JOURNAL_MAX_ENTRIES_ENV_VAR]: '0' };
    for (const subject of ['a', 'b', 'c', 'd']) {
      appendJournalEntry(buildJournalEntry({ ts: 't', tool: 'Bash', subject, decision, mode: 'soft' }), {
        cwd: dir,
        env,
      });
    }
    const names = readdirSync(dirname(journalPath(dir)));
    assert.deepEqual(names, ['guard-journal.jsonl'], 'no archive should be created when rotation is disabled');
    assert.equal(parseJournal(readFileSync(journalPath(dir), 'utf8')).length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
