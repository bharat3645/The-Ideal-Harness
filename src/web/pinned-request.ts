/**
 * DNS-rebinding-proof request: connects to a specific, already-validated IP address
 * instead of letting the runtime re-resolve the hostname at connect time.
 *
 * Why this exists (ROADMAP.md #5, supersedes `decisions.md` D026's stated gap):
 * `ssrf.ts`'s `checkUrlSafety` validates a hostname's resolved address(es) at
 * check-time. Plain `fetch()` then does its OWN, separate DNS resolution when the
 * actual TCP connection opens moments later — a classic time-of-check-to-time-of-use
 * gap. An attacker who controls DNS for the target hostname can serve a public
 * address for the check and a private one (or cloud-metadata `169.254.169.254`) for
 * the real connection, walking straight through the SSRF guard.
 *
 * The fix: resolve once, validate that address, then force the socket to connect to
 * THAT exact address — never re-resolving — while still sending the correct `Host`
 * header (virtual hosting) and TLS SNI/certificate hostname (`servername`), so the
 * target server still sees a normal request for the real hostname.
 *
 * Deliberately zero-dependency: Node's global `fetch()` is undici-backed, and undici
 * supports exactly this via a custom dispatcher — but `node:undici` is not importable
 * as a built-in module on the Node versions this project targets (verified directly,
 * not assumed), and adding the `undici` package as a dependency would be the kind of
 * addition `decisions.md` D007 explicitly gates behind human sign-off. Node's built-in
 * `node:http`/`node:https` `request()` achieve the identical pinning with zero new
 * dependencies, at the cost of hand-rolling response streaming instead of getting a
 * `Response` object for free — the same trade this project already made for HTML
 * extraction in `fetch.ts`.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface PinnedHeaders {
  get(name: string): string | null;
}

export interface PinnedResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: PinnedHeaders;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PinnedFetchOptions {
  readonly signal?: AbortSignal;
  /** Truncate the response body once it exceeds this many bytes, closing the socket early rather than buffering unbounded. */
  readonly maxBytes?: number;
}

function headersOf(raw: import('node:http').IncomingHttpHeaders): PinnedHeaders {
  return {
    get(name: string): string | null {
      const v = raw[name.toLowerCase()];
      if (v === undefined) return null;
      return Array.isArray(v) ? v.join(', ') : v;
    },
  };
}

/**
 * GET `url`, but connect the socket to `pinnedIp` instead of re-resolving `url.hostname`.
 * `pinnedIp` must already be validated safe by `checkUrlSafety` — this function does not
 * re-check it, by design, since re-checking would just move the TOCTOU gap rather than
 * closing it (the whole point is that no resolution happens between validation and connect).
 */
export function pinnedFetch(url: URL, pinnedIp: string, options: PinnedFetchOptions = {}): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const port = url.port !== '' ? Number(url.port) : isHttps ? 443 : 80;

    const req = requestFn(
      {
        host: pinnedIp,
        port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // Preserve virtual hosting: the target sees a normal request for the real
        // hostname even though the socket connected to a raw, pre-validated IP.
        headers: { Host: url.host },
        // TLS SNI + certificate hostname verification against the REAL hostname, not
        // the pinned IP — decoupled from `host` above via this explicit option.
        ...(isHttps ? { servername: url.hostname } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          if (options.maxBytes !== undefined) {
            const roomLeft = options.maxBytes - received;
            if (roomLeft <= 0) {
              res.destroy();
              return;
            }
            if (chunk.length > roomLeft) {
              chunks.push(chunk.subarray(0, roomLeft));
              received += roomLeft;
              res.destroy();
              return;
            }
          }
          chunks.push(chunk);
          received += chunk.length;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks);
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: headersOf(res.headers),
            arrayBuffer: async () =>
              body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
          });
        });
        res.on('error', reject);
      },
    );

    req.on('error', reject);

    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        req.destroy(new Error('aborted'));
        return;
      }
      options.signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    }

    req.end();
  });
}
