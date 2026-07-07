import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendJournalEntry,
  buildJournalEntry,
  JOURNAL_ENV_VAR,
  JOURNAL_SUBJECT_MAX,
  journalPath,
  parseJournal,
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
