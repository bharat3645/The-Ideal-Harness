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

  constructor(capTokens: number | null = null) {
    // Reject NaN/Infinity/negative caps loudly. A NaN cap (e.g. from a typo'd
    // env var coerced via Number()) would make every `wouldExceed` comparison
    // false and silently disable the cap — the exact failure we must prevent.
    if (capTokens !== null && (!Number.isFinite(capTokens) || capTokens < 0)) {
      throw new Error(`invalid spend cap: ${capTokens} (must be a non-negative finite number or null)`);
    }
    this.capTokens = capTokens;
  }

  record(tokens: number): void {
    if (tokens < 0) {
      throw new Error('cannot record negative spend');
    }
    this.used += tokens;
  }

  spent(): number {
    return this.used;
  }

  remaining(): number {
    return this.capTokens === null ? Number.POSITIVE_INFINITY : Math.max(0, this.capTokens - this.used);
  }

  wouldExceed(tokens: number): boolean {
    return this.capTokens !== null && this.used + tokens > this.capTokens;
  }

  /** Gate a prospective spend. Blocks (allowed:false) if it would exceed the cap. */
  check(tokens: number): SpendCheck {
    if (this.wouldExceed(tokens)) {
      return {
        allowed: false,
        reason: `spend cap reached: ${this.used}+${tokens} > ${this.capTokens}`,
      };
    }
    return { allowed: true };
  }
}
