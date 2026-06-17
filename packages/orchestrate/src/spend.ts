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

  constructor(private readonly capTokens: number | null = null) {}

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
