/**
 * @ideal-harness/web — fetch + extract + live docs.
 *
 * A minimal, dependency-free web engine: fetch a URL and extract its
 * readable text, or look up a package's live registry metadata/README —
 * both grounded against the real, current internet instead of a model's
 * (possibly stale) training data. Scoped down from a full browser-daemon
 * ambition (see fetch.ts's module doc for why); every outbound call is
 * gated by the same WebFetch policy the native tool already goes through.
 */

export { fetchPackageDocs, type PackageDocsOptions, type PackageDocsResult } from './docs.js';
export { extractReadableText, type FetchPageOptions, type FetchPageResult, fetchPage } from './fetch.js';
export { gateWebFetch } from './gate.js';
export { checkUrlSafety, type DnsLookupFn, isPrivateOrReservedIp, type SsrfCheckResult } from './ssrf.js';
