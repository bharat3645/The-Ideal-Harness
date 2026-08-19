/**
 * Compress-Cache-Retrieve (CCR).
 *
 * Lossy compression is made lossless end-to-end: the dropped original is stashed
 * keyed by a content hash, and an inline `<<ccr:HASH>>` marker is left behind.
 * The agent can pull the original back on demand via the `ccr_retrieve` tool, so
 * no information is permanently lost — it's just moved out of the live context.
 *
 * Scope, stated plainly (`decisions.md` D035): this is a process-lifetime
 * convenience, not a durable store. Unlike the structural graph and episodic
 * store — which represent accumulated knowledge worth persisting across
 * restarts — CCR exists so a model that just received a marker can pull the
 * original back within the same session. A marker does not survive an MCP
 * server restart; there is no disk backing, by design.
 */

import { createHash } from 'node:crypto';

export const CCR_MARKER = /<<ccr:([0-9a-f]{16})>>/gi;

export function isCompressed(text: string): boolean {
  CCR_MARKER.lastIndex = 0;
  return CCR_MARKER.test(text);
}

/** Default byte cap: generous for a long session, small next to typical process memory. */
const DEFAULT_CAP_BYTES = 50 * 1024 * 1024; // 50 MiB

export class CcrStore {
  // Map iteration order is insertion order. `touch()` deletes+re-inserts an
  // entry to move it to the end, so the map's front is always the true
  // least-recently-used entry — an LRU list without a second data structure.
  private readonly store = new Map<string, string>();
  private readonly byteSizes = new Map<string, number>();
  private totalBytes = 0;
  private readonly capBytes: number;

  constructor(capBytes: number = DEFAULT_CAP_BYTES) {
    if (!Number.isFinite(capBytes) || capBytes <= 0) {
      throw new Error(`invalid CCR cap: ${capBytes} (must be a positive finite number of bytes)`);
    }
    this.capBytes = capBytes;
  }

  /** Stash an original payload; returns its inline marker. May evict least-recently-used entries to stay under the byte cap. */
  stash(original: string): string {
    const hash = createHash('sha256').update(original).digest('hex').slice(0, 16);
    if (this.store.has(hash)) {
      // Exact-content dedup: already stashed. Touch it as most-recently-used
      // (a re-stash is a signal the payload is live again) and hand back the
      // same marker rather than double-counting its bytes.
      this.touch(hash);
      return `<<ccr:${hash}>>`;
    }
    const bytes = Buffer.byteLength(original, 'utf8');
    this.store.set(hash, original);
    this.byteSizes.set(hash, bytes);
    this.totalBytes += bytes;
    this.evictIfNeeded();
    return `<<ccr:${hash}>>`;
  }

  /** Retrieve a stashed original by hash or by its `<<ccr:HASH>>` marker. `undefined` covers both "never stashed" and "evicted" — the caller (`ccr_retrieve`) reports both as one honest "not found." */
  retrieve(hashOrMarker: string): string | undefined {
    // Match case-insensitively and fold to lowercase: stored hashes are always
    // lowercase, but a marker copied through an LLM or a user may arrive uppercased.
    const match = hashOrMarker.match(/[0-9a-f]{16}/i);
    if (match === null) {
      return undefined;
    }
    const hash = match[0].toLowerCase();
    const value = this.store.get(hash);
    if (value !== undefined) {
      this.touch(hash);
    }
    return value;
  }

  /** Move an entry to the most-recently-used position without changing its value or byte accounting. */
  private touch(hash: string): void {
    const value = this.store.get(hash);
    const bytes = this.byteSizes.get(hash);
    if (value === undefined || bytes === undefined) {
      return;
    }
    this.store.delete(hash);
    this.store.set(hash, value);
    this.byteSizes.delete(hash);
    this.byteSizes.set(hash, bytes);
  }

  private evict(hash: string): void {
    const bytes = this.byteSizes.get(hash) ?? 0;
    this.store.delete(hash);
    this.byteSizes.delete(hash);
    this.totalBytes -= bytes;
  }

  private evictIfNeeded(): void {
    // `> 1`, not `> 0`: a single entry larger than the cap on its own is kept
    // alone rather than evicted immediately after being stashed — evicting
    // the only entry left would defeat the point of just having stashed it.
    while (this.totalBytes > this.capBytes && this.store.size > 1) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.evict(oldest);
    }
  }

  /** Explicitly evict down to the byte cap. Returns the number of entries evicted. Safe to call any time; a no-op under the cap. */
  prune(): number {
    const before = this.store.size;
    this.evictIfNeeded();
    return before - this.store.size;
  }

  get size(): number {
    return this.store.size;
  }

  /** Total bytes currently stashed (UTF-8), for observability against the cap. */
  get bytes(): number {
    return this.totalBytes;
  }
}
