/**
 * Compress-Cache-Retrieve (CCR).
 *
 * Lossy compression is made lossless end-to-end: the dropped original is stashed
 * keyed by a content hash, and an inline `<<ccr:HASH>>` marker is left behind.
 * The agent can pull the original back on demand via the `ccr_retrieve` tool, so
 * no information is permanently lost — it's just moved out of the live context.
 *
 * The same hash → marker index also backs cross-turn dedup (`detect.ts`'s
 * `dedupe` option): a second occurrence of exact-identical content within the
 * same store's lifetime is a pointer lookup away, not a second stash. One
 * mechanism, two callers — see decisions.md D039.
 */

import { createHash } from 'node:crypto';

export const CCR_MARKER = /<<ccr:([0-9a-f]{16})>>/gi;

export function isCompressed(text: string): boolean {
  CCR_MARKER.lastIndex = 0;
  return CCR_MARKER.test(text);
}

/** Deterministic, exact-match content hash — the same algorithm behind every `<<ccr:HASH>>` marker. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export class CcrStore {
  private readonly store = new Map<string, string>();

  /** Stash an original payload; returns its inline marker. Idempotent: re-stashing identical content returns the same marker without a second entry. */
  stash(original: string): string {
    const hash = hashContent(original);
    this.store.set(hash, original);
    return `<<ccr:${hash}>>`;
  }

  /** Retrieve a stashed original by hash or by its `<<ccr:HASH>>` marker. */
  retrieve(hashOrMarker: string): string | undefined {
    // Match case-insensitively and fold to lowercase: stored hashes are always
    // lowercase, but a marker copied through an LLM or a user may arrive uppercased.
    const match = hashOrMarker.match(/[0-9a-f]{16}/i);
    if (match === null) {
      return undefined;
    }
    return this.store.get(match[0].toLowerCase());
  }

  /**
   * Look up the marker for exact-identical content already stashed earlier —
   * without stashing it. Returns undefined on first occurrence (nothing to
   * point to yet). Exact-hash-match only: no fuzzy or near-duplicate detection.
   */
  peekMarker(content: string): string | undefined {
    const hash = hashContent(content);
    return this.store.has(hash) ? `<<ccr:${hash}>>` : undefined;
  }

  get size(): number {
    return this.store.size;
  }
}
