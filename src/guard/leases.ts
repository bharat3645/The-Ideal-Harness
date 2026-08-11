/**
 * Capability leases — time/call-boxed elevated trust, narrower than a
 * permanent `ideal-harness.policy.json` rule.
 *
 * A human grants a lease ("allow Bash matching X for the next 30 minutes, or
 * the next 5 calls, whichever comes first") via the CLI only — there is no
 * MCP tool that grants a lease, deliberately: a model that could grant its
 * own elevated capability would defeat the entire point of the floor being
 * human-owned. `lease list` (read-only) is fine to expose; grant/revoke are not.
 *
 * Leases are stored at `.ideal-harness/leases.json`, itself covered by the
 * self-policy deny pattern (see `defaults.ts`) so the model cannot edit the
 * file directly either — the same asymmetry `ideal-harness.policy.json` has.
 *
 * Precedence: leases form the tier CHECKED FIRST, ahead of user policy and
 * the default floor (see `evaluateTiered`) — the same override power a user
 * policy `allow` rule already has over a default `deny` (this is pre-existing
 * behavior in `evaluateTiered`/`composePolicy`, not new to leases). A lease's
 * only extra safety property over a permanent user rule is that it expires.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PolicyRule } from './policy/types.js';

export interface CapabilityLease {
  readonly id: string;
  readonly tool: string;
  readonly match: string;
  readonly reason: string;
  /** Unix ms the lease was granted. */
  readonly grantedAt: number;
  /** Unix ms after which the lease is no longer live. Absent = call-count-bound only. */
  readonly expiresAt?: number;
  /** Max matching calls the lease may authorize. Absent = time-bound only. */
  readonly maxCalls?: number;
  readonly usedCalls: number;
}

export function leasesPath(cwd: string = process.cwd()): string {
  return join(cwd, '.ideal-harness', 'leases.json');
}

/** Load leases from disk. Missing or corrupt file → empty list (fail-open, never throws). */
export function loadLeases(cwd: string = process.cwd()): CapabilityLease[] {
  const path = leasesPath(cwd);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? (parsed.filter(isCapabilityLease) as CapabilityLease[]) : [];
  } catch {
    return [];
  }
}

function isCapabilityLease(value: unknown): value is CapabilityLease {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const l = value as Record<string, unknown>;
  return (
    typeof l.id === 'string' &&
    typeof l.tool === 'string' &&
    typeof l.match === 'string' &&
    typeof l.reason === 'string' &&
    typeof l.grantedAt === 'number' &&
    typeof l.usedCalls === 'number' &&
    (l.expiresAt === undefined || typeof l.expiresAt === 'number') &&
    (l.maxCalls === undefined || typeof l.maxCalls === 'number')
  );
}

/** Persist leases atomically (temp file + rename). Returns false on any I/O failure, never throws. */
export function saveLeases(leases: readonly CapabilityLease[], cwd: string = process.cwd()): boolean {
  try {
    const path = leasesPath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(leases, null, 2), 'utf8');
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/** A lease is live when it hasn't hit its time bound (if any) or its call bound (if any). */
export function isLeaseLive(lease: CapabilityLease, now: number): boolean {
  if (lease.expiresAt !== undefined && now >= lease.expiresAt) {
    return false;
  }
  if (lease.maxCalls !== undefined && lease.usedCalls >= lease.maxCalls) {
    return false;
  }
  return true;
}

/** Drop leases that are no longer live. Pure. */
export function pruneExpired(leases: readonly CapabilityLease[], now: number): CapabilityLease[] {
  return leases.filter((l) => isLeaseLive(l, now));
}

function formatBound(lease: CapabilityLease): string {
  const parts: string[] = [];
  if (lease.expiresAt !== undefined) {
    parts.push(`until ${new Date(lease.expiresAt).toISOString()}`);
  }
  if (lease.maxCalls !== undefined) {
    parts.push(`${lease.usedCalls}/${lease.maxCalls} calls used`);
  }
  return parts.length > 0 ? parts.join(', ') : 'unbounded (grant it a time or call limit)';
}

/** Convert a live lease into a policy rule for the lease tier. */
export function leaseToRule(lease: CapabilityLease): PolicyRule {
  return {
    id: `lease:${lease.id}`,
    action: 'allow',
    tool: lease.tool,
    match: lease.match,
    description: `capability lease "${lease.id}": ${lease.reason} (${formatBound(lease)})`,
  };
}

/** Rules for every currently-live lease, ready to use as the first `evaluateTiered` tier. */
export function activeLeaseRules(leases: readonly CapabilityLease[], now: number): PolicyRule[] {
  return pruneExpired(leases, now).map(leaseToRule);
}

export interface GrantLeaseInput {
  readonly tool: string;
  readonly match: string;
  readonly reason: string;
  /** Lease lifetime in minutes from now. */
  readonly minutes?: number;
  readonly maxCalls?: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Grant a new lease: load, append, save. Human-invoked (CLI) only — see module doc. */
export function grantLease(
  input: GrantLeaseInput,
  cwd: string = process.cwd(),
  now: number = Date.now(),
): CapabilityLease {
  const lease: CapabilityLease = {
    id: `${slugify(input.tool)}-${slugify(input.match)}-${now}`,
    tool: input.tool,
    match: input.match,
    reason: input.reason,
    grantedAt: now,
    ...(input.minutes !== undefined ? { expiresAt: now + input.minutes * 60_000 } : {}),
    ...(input.maxCalls !== undefined ? { maxCalls: input.maxCalls } : {}),
    usedCalls: 0,
  };
  const leases = [...pruneExpired(loadLeases(cwd), now), lease];
  saveLeases(leases, cwd);
  return lease;
}

/** Revoke a lease by id. Returns true if a lease was actually removed. */
export function revokeLease(id: string, cwd: string = process.cwd()): boolean {
  const leases = loadLeases(cwd);
  const remaining = leases.filter((l) => l.id !== id);
  if (remaining.length === leases.length) {
    return false;
  }
  saveLeases(remaining, cwd);
  return true;
}

/** Record that a lease's rule actually decided a request — consumes one call. */
export function consumeLease(id: string, cwd: string = process.cwd(), now: number = Date.now()): boolean {
  const leases = pruneExpired(loadLeases(cwd), now);
  let found = false;
  const updated = leases.map((l) => {
    if (l.id === id) {
      found = true;
      return { ...l, usedCalls: l.usedCalls + 1 };
    }
    return l;
  });
  if (!found) {
    return false;
  }
  saveLeases(pruneExpired(updated, now), cwd);
  return true;
}
