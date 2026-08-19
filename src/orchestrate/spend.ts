/**
 * Spend governor — token/cost accounting with a hard cap.
 *
 * The control-flow pillar's budget control: every unit of spend is recorded,
 * and a request that would exceed the cap is blocked before it runs. A null cap
 * means unmetered (remaining is Infinity). Mirrors a spending-cap safeguard.
 */

export interface SpendCheck {
  readonly allowed: boolean;
  readonly reason?: string;
}

export class SpendGovernor {
  private used = 0;
  private readonly capTokens: number | null;

  /**
   * @param initialUsed Prior spend to restore (e.g. from a persisted checkpoint
   *   after an MCP server restart) instead of starting at zero. Same validation
   *   as `record()` — a NaN/negative/infinite value would silently disable the
   *   cap, so it's rejected loudly rather than coerced.
   */
  constructor(capTokens: number | null = null, initialUsed = 0) {
    // Reject NaN/Infinity/negative caps loudly. A NaN cap (e.g. from a typo'd
    // env var coerced via Number()) would make every `wouldExceed` comparison
    // false and silently disable the cap — the exact failure we must prevent.
    if (capTokens !== null && (!Number.isFinite(capTokens) || capTokens < 0)) {
      throw new Error(`invalid spend cap: ${capTokens} (must be a non-negative finite number or null)`);
    }
    if (!Number.isFinite(initialUsed) || initialUsed < 0) {
      throw new Error(`invalid initial spend: ${initialUsed} (must be a non-negative finite number)`);
    }
    this.capTokens = capTokens;
    this.used = initialUsed;
  }

  record(tokens: number): void {
    // Reject NaN/Infinity too, not just negatives: recording NaN would poison
    // `used` forever (NaN + anything = NaN), making every later wouldExceed()
    // comparison false and silently disabling the cap.
    if (!Number.isFinite(tokens) || tokens < 0) {
      throw new Error(`cannot record invalid spend: ${tokens} (must be a non-negative finite number)`);
    }
    this.used += tokens;
  }

  spent(): number {
    return this.used;
  }

  /**
   * Overwrite `used` with an absolute value (as opposed to `record`, which
   * adds). Used to resync this governor to the freshest cross-process total
   * after a lock-protected reload-merge-write cycle (see issue #17 /
   * `decisions.md` D039) — same validation as the constructor's
   * `initialUsed`, since a NaN/negative value here would silently disable
   * the cap exactly like an invalid `record()` call would.
   */
  restore(used: number): void {
    if (!Number.isFinite(used) || used < 0) {
      throw new Error(`cannot restore invalid spend: ${used} (must be a non-negative finite number)`);
    }
    this.used = used;
  }

  remaining(): number {
    return this.capTokens === null ? Number.POSITIVE_INFINITY : Math.max(0, this.capTokens - this.used);
  }

  wouldExceed(tokens: number): boolean {
    return this.capTokens !== null && this.used + tokens > this.capTokens;
  }

  /** Gate a prospective spend. Blocks (allowed:false) if it would exceed the cap. */
  check(tokens: number): SpendCheck {
    // Deny-wins on garbage input: an invalid token count can never be "allowed".
    if (!Number.isFinite(tokens) || tokens < 0) {
      return { allowed: false, reason: `invalid token count: ${tokens}` };
    }
    if (this.wouldExceed(tokens)) {
      return {
        allowed: false,
        reason: `spend cap reached: ${this.used}+${tokens} > ${this.capTokens}`,
      };
    }
    return { allowed: true };
  }
}

/**
 * Persisted spend-checkpoint shape. Pure serialize/parse only — the atomic-write,
 * quarantine-on-corrupt I/O lives in `runtime/mcp.ts`, mirroring how `checkpoint.ts`
 * stays I/O-free and `runtime/mcp.ts` owns the ledger's own read/write/quarantine.
 */
export interface SpendState {
  readonly used: number;
  /** Unix ms, supplied by the caller. */
  readonly ts: number;
}

export function serializeSpendState(state: SpendState): string {
  return JSON.stringify(state);
}

/** Throws on any missing/wrong-typed field — the caller decides what "invalid" means (fail closed). */
export function parseSpendState(json: string): SpendState {
  const data = JSON.parse(json) as Partial<SpendState>;
  if (typeof data.used !== 'number' || !Number.isFinite(data.used) || data.used < 0) {
    throw new Error('invalid spend state: "used" must be a non-negative finite number');
  }
  if (typeof data.ts !== 'number') {
    throw new Error('invalid spend state: missing ts');
  }
  return { used: data.used, ts: data.ts };
}
