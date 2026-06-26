import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../../src/core/logger.js';

test('caller fields cannot clobber the record level or message', () => {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  log.warn('real message', { level: 'debug', msg: 'fake', detail: 42 });

  const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
  assert.equal(record.level, 'warn', 'level must reflect the actual call, not a caller field');
  assert.equal(record.msg, 'real message', 'msg must reflect the actual call, not a caller field');
  assert.equal(record.detail, 42, 'other fields still merge through');
});

test('child base fields cannot clobber level or message either', () => {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) }).child({ msg: 'base-msg' });
  log.error('boom');

  const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
  assert.equal(record.level, 'error');
  assert.equal(record.msg, 'boom');
});

test('level threshold still filters records below the configured level', () => {
  const lines: string[] = [];
  const log = createLogger({ level: 'warn', sink: (line) => lines.push(line) });
  log.info('suppressed');
  log.error('kept');
  assert.equal(lines.length, 1);
  assert.match(lines[0] as string, /"msg":"kept"/);
});
