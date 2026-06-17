/**
 * Compress-Cache-Retrieve (CCR).
 *
 * Lossy compression is made lossless end-to-end: the dropped original is stashed
 * keyed by a content hash, and an inline `<<ccr:HASH>>` marker is left behind.
 * The agent can pull the original back on demand via the `ccr_retrieve` tool, so
 * no information is permanently lost — it's just moved out of the live context.
 */

import { createHash } from 'node:crypto';

export const CCR_MARKER = /<<ccr:([0-9a-f]{16})>>/g;

export function isCompressed(text: string): boolean {
  CCR_MARKER.lastIndex = 0;
  return CCR_MARKER.test(text);
}

export class CcrStore {
  private readonly store = new Map<string, string>();

  /** Stash an original payload; returns its inline marker. */
  stash(original: string): string {
    const hash = createHash('sha256').update(original).digest('hex').slice(0, 16);
    this.store.set(hash, original);
    return `<<ccr:${hash}>>`;
  }

  /** Retrieve a stashed original by hash or by its `<<ccr:HASH>>` marker. */
  retrieve(hashOrMarker: string): string | undefined {
    const match = hashOrMarker.match(/[0-9a-f]{16}/);
    if (match === null) {
      return undefined;
    }
    return this.store.get(match[0]);
  }

  get size(): number {
    return this.store.size;
  }
}
