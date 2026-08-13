/**
 * @ideal-harness/web — fetch + extract + live docs + browse.
 *
 * A minimal web engine: fetch a URL and extract its readable text, look up
 * a package's live registry metadata/README, or drive a real Chromium
 * session — all grounded against the real, current internet instead of a
 * model's (possibly stale) training data. `fetch`/`docs` are dependency-free;
 * `browse` uses the operator's own already-installed Chrome (never bundled/
 * downloaded by this package) plus one optional devDependency (`ws`) for the
 * CDP WebSocket layer — the same "optional engine tier, degrades to a clear
 * error when absent" contract `memory`'s tree-sitter tier already
 * established, not a hard runtime dependency (see `browse/daemon.ts`'s
 * module doc). Every outbound call — fetch, docs, or browse — is gated by
 * the same `WebFetch` policy the native tool already goes through.
 */

export {
  BROWSE_DEBUG_ENV_VAR,
  type CdpSession,
  clearDaemonState,
  click,
  connectCdp,
  type DaemonState,
  DEFAULT_IDLE_MS,
  daemonStatePath,
  type EnsureDaemonOptions,
  type EnsureDaemonResult,
  ensureDaemon,
  evaluate,
  findChromeExecutable,
  isProcessAlive,
  loadWebSocketCtor,
  navigate,
  readDaemonState,
  type SnapshotElement,
  screenshot,
  shutdownDaemon,
  snapshot,
  touchActivity,
  typeText,
  writeDaemonState,
} from './browse/index.js';
export { fetchPackageDocs, type PackageDocsOptions, type PackageDocsResult } from './docs.js';
export { extractReadableText, type FetchPageOptions, type FetchPageResult, fetchPage } from './fetch.js';
export { gateBrowse, gateWebFetch } from './gate.js';
export { checkUrlSafety, type DnsLookupFn, isPrivateOrReservedIp, type SsrfCheckResult } from './ssrf.js';
