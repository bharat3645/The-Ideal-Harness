import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backoffSchedule, classifyApiError, withRetry } from '../src/retry.js';

test('classifies API errors correctly', () => {
  assert.equal(classifyApiError({ status: 429 }), 'retryable');
  assert.equal(classifyApiError({ status: 503 }), 'retryable');
  assert.equal(classifyApiError({ code: 'ETIMEDOUT' }), 'retryable');
  assert.equal(classifyApiError({ message: 'server overloaded, retry' }), 'retryable');
  assert.equal(classifyApiError({ status: 400 }), 'fatal');
  assert.equal(classifyApiError({ status: 401 }), 'fatal');
});

test('backoff schedule is exponential and capped', () => {
  assert.deepEqual(backoffSchedule(4, 500, 30_000), [500, 1000, 2000, 4000]);
  assert.deepEqual(backoffSchedule(3, 10_000, 15_000), [10_000, 15_000, 15_000]);
});

test('withRetry retries retryable failures then succeeds', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw { status: 429 };
      }
      return 'ok';
    },
    { sleep: async (ms) => void sleeps.push(ms) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
});

test('withRetry rejects an invalid maxAttempts instead of throwing undefined', async () => {
  await assert.rejects(
    withRetry(async () => 'x', { maxAttempts: 0 }),
    RangeError,
  );
  await assert.rejects(
    withRetry(async () => 'x', { maxAttempts: -1 }),
    RangeError,
  );
});

test('withRetry re-throws fatal errors immediately', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw { status: 400, message: 'bad request' };
      },
      { sleep: async () => {} },
    ),
  );
  assert.equal(calls, 1);
});
