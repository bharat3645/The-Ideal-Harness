/**
 * Loop / no-progress guard (hermes idea).
 *
 * Hashes each action signature; if the same action repeats N times in a row,
 * the agent is stuck and the controller should break the loop (escalate, change
 * strategy, or stop) rather than burn budget repeating itself.
 */

import { createHash } from 'node:crypto';

export interface LoopCheck {
  readonly repeats: number;
  readonly stalled: boolean;
}

export class LoopGuard {
  private lastHash: string | null = null;
  private consecutive = 0;

  constructor(private readonly threshold = 3) {}

  /** Record an action signature; returns whether the agent appears stalled. */
  record(signature: string): LoopCheck {
    const hash = createHash('sha256').update(signature).digest('hex');
    if (hash === this.lastHash) {
      this.consecutive += 1;
    } else {
      this.lastHash = hash;
      this.consecutive = 1;
    }
    return { repeats: this.consecutive, stalled: this.consecutive >= this.threshold };
  }

  reset(): void {
    this.lastHash = null;
    this.consecutive = 0;
  }
}
