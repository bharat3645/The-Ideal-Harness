/**
 * SSRF guard for the `web` module's outbound fetches.
 *
 * `web_fetch` accepts an arbitrary URL from the model — if the model is ever steered
 * (prompt injection, a confused plan) into fetching an internal address, that's a
 * pivot from "read a web page" to "reach the internal network" (cloud metadata
 * endpoints, internal admin panels, localhost services). DESIGN.md's own risk log
 * (§10 R2) named this as security-sensitive and specifically warned that clean-room
 * SSRF guards classically miss DNS-rebinding, redirect-following, and decimal/octal/
 * hex IP-literal bypasses — so this module is deliberately narrow and explicit about
 * what it does and does not cover, rather than claiming complete protection.
 *
 * What this blocks:
 *   - literal private/loopback/link-local/reserved IPv4 and IPv6 addresses, including
 *     the IPv4-mapped-IPv6 form (`::ffff:127.0.0.1`) and the cloud-metadata address
 *     (169.254.169.254, covered by the 169.254.0.0/16 link-local range)
 *   - the `localhost` / `*.localhost` hostname
 *   - decimal/octal/hex-encoded IPv4 literals (e.g. `http://2130706433/`) — the
 *     WHATWG URL parser normalizes these into dotted-quad form in `url.hostname`
 *     before this module ever sees them, so checking the normalized hostname already
 *     covers this class, with no extra parsing needed here
 *   - a hostname that resolves (via DNS) to a private/reserved address — ALL resolved
 *     addresses are checked, not just the first
 *   - a redirect chain that leads to any of the above — `fetchPage`/`fetchPackageDocs`
 *     must use `redirect: 'manual'` and re-validate each hop through this module
 *     (implemented in `fetch.ts`/`docs.ts`, not here)
 *
 * DNS rebinding (ROADMAP.md #5, supersedes `decisions.md` D026's stated gap): CLOSED.
 * `checkUrlSafety` now returns the exact validated address (`pinnedIp`) alongside its
 * verdict, and callers (`fetch.ts`) connect to THAT address directly via
 * `pinned-request.ts` instead of letting `fetch()` re-resolve the hostname at connect
 * time — there is no longer a gap between "the address that was checked" and "the
 * address that gets connected to," because they're the same value threaded through,
 * not two independent DNS lookups. See `pinned-request.ts`'s own docblock for why this
 * needed zero new dependencies.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SsrfCheckResult {
  readonly safe: boolean;
  readonly reason?: string;
  /**
   * The exact address this verdict was computed against — present whenever `safe` is
   * true. Callers MUST connect to this address directly (see `pinned-request.ts`)
   * rather than re-resolving the hostname, or the DNS-rebinding gap this field exists
   * to close reopens. For a literal IP URL, this is that same address (no DNS
   * involved, pinning is a no-op but harmless). For a hostname, this is one specific
   * address from the resolved set that was validated safe — `resolved[0]`,
   * deterministically, not "whichever the runtime happens to connect to."
   */
  readonly pinnedIp?: string;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918 private
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 private
  if (a === 192 && b === 168) return true; // RFC1918 private
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata 169.254.169.254
  if (a === 0) return true; // "this" network
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224-239) + reserved (240-255)
  return false;
}

/** Reassemble two 16-bit hex groups (as produced by the IPv6 mixed-notation serializer) into a dotted-quad. */
function hexPairToIpv4(hi: string, lo: string): string {
  const h = Number.parseInt(hi, 16);
  const l = Number.parseInt(lo, 16);
  return `${(h >> 8) & 0xff}.${h & 0xff}.${(l >> 8) & 0xff}.${l & 0xff}`;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  const dottedMapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped?.[1] !== undefined) return isPrivateOrReservedIpv4(dottedMapped[1]);
  // The WHATWG URL parser's IPv6 serializer never preserves dotted-decimal notation for
  // an IPv4-mapped address: new URL('http://[::ffff:127.0.0.1]/').hostname comes back as
  // "[::ffff:7f00:1]" -- the same 32 bits, compressed hex. A hostname reaching this
  // function via checkUrlSafety needs that form recognized too, not just the
  // dotted-decimal form isPrivateOrReservedIp() also accepts when called directly with a
  // literal string. See ROADMAP.md #11.
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped?.[1] !== undefined && hexMapped[2] !== undefined) {
    return isPrivateOrReservedIpv4(hexPairToIpv4(hexMapped[1], hexMapped[2]));
  }
  return false;
}

/** True if `ip` (a literal, already-resolved IP address) is private/loopback/link-local/reserved. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrReservedIpv4(ip);
  if (version === 6) return isPrivateOrReservedIpv6(ip);
  return true; // not a parseable IP literal at all -- treat conservatively, never pass through unchecked
}

const LOCALHOST_HOSTNAME = /^localhost$|\.localhost$/i;

export type DnsLookupFn = (hostname: string, options: { all: true }) => Promise<readonly { address: string }[]>;

/**
 * Check a URL's hostname before it is fetched: reject `localhost`, reject a literal
 * private/reserved IP outright, and reject a hostname whose DNS resolution includes
 * any private/reserved address. Never throws — a DNS failure is reported as unsafe
 * (fail closed), not silently passed through.
 *
 * `lookupFn` defaults to the real `dns/promises` resolver; tests inject a fake one so
 * the suite stays offline-runnable (matches this project's "no live network calls in
 * tests" convention) without weakening the real default behavior.
 */
export async function checkUrlSafety(url: URL, lookupFn: DnsLookupFn = lookup): Promise<SsrfCheckResult> {
  const hostname = url.hostname;
  if (LOCALHOST_HOSTNAME.test(hostname)) {
    return { safe: false, reason: `refuses to fetch localhost ("${hostname}")` };
  }
  // The WHATWG URL parser keeps brackets on an IPv6 literal's hostname (e.g. "[::1]"),
  // but net.isIP() rejects bracketed input outright and returns 0 -- without stripping
  // them first, a bracketed IPv6 literal would miss the literal-IP fast path below and
  // fall through to a DNS lookup that can only fail, misreporting the block as a DNS
  // failure instead of a private/reserved IP literal (and blocking legitimate public
  // IPv6 literals for the wrong reason). See ROADMAP.md #11.
  const bareHostname = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const literalVersion = isIP(bareHostname);
  if (literalVersion !== 0) {
    if (isPrivateOrReservedIp(bareHostname)) {
      return { safe: false, reason: `refuses to fetch a private/reserved IP literal ("${hostname}")` };
    }
    return { safe: true, pinnedIp: bareHostname };
  }
  let resolved: readonly { address: string }[];
  try {
    resolved = await lookupFn(hostname, { all: true });
  } catch (error) {
    return { safe: false, reason: `DNS resolution failed for "${hostname}": ${String(error)}` };
  }
  if (resolved.length === 0) {
    return { safe: false, reason: `"${hostname}" resolved to no addresses` };
  }
  const privateHit = resolved.find((r) => isPrivateOrReservedIp(r.address));
  if (privateHit !== undefined) {
    return {
      safe: false,
      reason: `"${hostname}" resolves to a private/reserved address (${privateHit.address})`,
    };
  }
  // Pin to the FIRST resolved address, deterministically — not "whichever fetch()
  // would have picked," since the whole point is one specific, already-validated
  // address flowing straight into the connection with no second resolution.
  // `resolved[0]` is guaranteed to exist: the `resolved.length === 0` case already
  // returned above.
  const first = resolved[0] as { address: string };
  return { safe: true, pinnedIp: first.address };
}
