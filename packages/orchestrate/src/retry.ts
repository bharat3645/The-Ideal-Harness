/**
 * API-level retry/backoff/circuit-breaking — distinct from web-fetch retry.
 *
 * Classifies Anthropic-style API errors (429 / overloaded / 5xx / network are
 * retryable; 4xx client errors are fatal) and retries with deterministic
 * exponential backoff. Backoff is computed, not random, so it is testable; the
 * sleep function is injectable for the same reason.
 */

export type ErrorClass = 'retryable' | 'fatal';

export interface ApiErrorShape {
  readonly status?: number;
  readonly code?: string;
  readonly message?: string;
}

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'overloaded_error']);

export function classifyApiError(error: ApiErrorShape): ErrorClass {
  const { status, code, message } = error;
  if (status === 429 || status === 408 || (status !== undefined && status >= 500)) {
    return 'retryable';
  }
  if (code !== undefined && RETRYABLE_CODES.has(code)) {
    return 'retryable';
  }
  if (message !== undefined && /overloaded|rate.?limit|timeout|temporarily/i.test(message)) {
    return 'retryable';
  }
  return 'fatal';
}

/** Deterministic exponential backoff schedule (ms), capped. */
export function backoffSchedule(attempts: number, baseMs = 500, maxMs = 30_000): number[] {
  return Array.from({ length: attempts }, (_, i) => Math.min(maxMs, baseMs * 2 ** i));
}

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseMs?: number;
  readonly maxMs?: number;
  /** Injectable for tests; default real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly classify?: (error: ApiErrorShape) => ErrorClass;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `fn`, retrying retryable failures with backoff. Re-throws fatal errors immediately. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    // Without this guard, maxAttempts < 1 skips the loop and throws `undefined`,
    // which a caller cannot meaningfully catch.
    throw new RangeError(`withRetry: maxAttempts must be a positive integer, got ${maxAttempts}`);
  }
  const classify = options.classify ?? classifyApiError;
  const sleep = options.sleep ?? realSleep;
  const schedule = backoffSchedule(maxAttempts, options.baseMs, options.maxMs);

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (classify(error as ApiErrorShape) === 'fatal' || attempt === maxAttempts - 1) {
        throw error;
      }
      await sleep(schedule[attempt] as number);
    }
  }
  throw lastError;
}
