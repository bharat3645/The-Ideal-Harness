/**
 * Fetch + extract — a minimal, dependency-free web engine for static pages.
 *
 * No headless browser here, no scraping library, no new dependency — just
 * the runtime's global `fetch` (Node >= 18) and a hand-rolled HTML text
 * extractor. This module deliberately stays a static fetcher; a real
 * Chromium session (JS-rendered pages, click/type/screenshot) is
 * `../browse/` — a separate, opt-in module using the operator's own
 * already-installed Chrome, not a bundled Chromium/Playwright dependency
 * this project's zero-runtime-deps goal (VISION §6.2) would otherwise
 * refuse. This one exists for the cheap, common case (grounding an answer
 * in real fetched text) without paying `browse`'s process-lifecycle cost
 * when a static GET is all that's needed.
 *
 * "Adaptive" extraction, honestly scoped: three cheap strategies run in
 * order of expected signal quality, and whichever yields the most text
 * wins — the idea worth taking from scrapling's self-healing selectors,
 * clean-room and without a real DOM engine.
 */

import type { PolicyDecision, PolicyRule } from '../guard/index.js';
import { gateWebFetch } from './gate.js';
import { checkUrlSafety } from './ssrf.js';

export interface FetchPageOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly policyTiers?: readonly (readonly PolicyRule[])[];
}

export interface FetchPageResult {
  readonly ok: boolean;
  readonly ran: boolean;
  readonly url: string;
  readonly status?: number;
  readonly title?: string;
  readonly text?: string;
  readonly error?: string;
  readonly decision: PolicyDecision;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTagsKeepText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strategy 1: `<main>`/`<article>` — the highest-signal region when a page marks one up. */
function extractSemanticRegion(html: string): string | null {
  const match = html.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  return match ? stripTagsKeepText(match[2] as string) : null;
}

/** Strategy 2: the single largest `<div>`/`<section>` by extracted text length — a crude "most content" heuristic. */
function extractLargestBlock(html: string): string | null {
  const blocks = [...html.matchAll(/<(?:div|section)[^>]*>([\s\S]*?)<\/(?:div|section)>/gi)].map((m) =>
    stripTagsKeepText(m[1] as string),
  );
  if (blocks.length === 0) {
    return null;
  }
  return blocks.reduce((best, b) => (b.length > best.length ? b : best), '');
}

/** Strategy 3: the whole `<body>` — always available, lowest signal-to-noise, the floor under the other two. */
function extractWholeBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return stripTagsKeepText(match ? (match[1] as string) : html);
}

/** Try strategies in signal-quality order; keep whichever actually extracted the most text. */
export function extractReadableText(html: string): string {
  const candidates = [extractSemanticRegion(html), extractLargestBlock(html), extractWholeBody(html)].filter(
    (c): c is string => c !== null && c.length > 0,
  );
  if (candidates.length === 0) {
    return '';
  }
  return candidates.reduce((best, c) => (c.length > best.length ? c : best));
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities((match[1] as string).trim()) : undefined;
}

/**
 * Fetch a URL and extract readable text. Policy-gated the same as the native
 * WebFetch tool (see gate.ts) — refuses (ran:false) unless the decision is an
 * explicit allow. Every hop (the initial URL and every redirect target) is checked
 * by the SSRF guard (ssrf.ts) before being fetched — `redirect: 'manual'` plus a
 * hand-rolled redirect loop, so a redirect to an internal address can't bypass the
 * check the way `redirect: 'follow'` would let it. Never throws.
 */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchPageResult> {
  const decision = gateWebFetch(url, options.policyTiers);
  if (decision.action !== 'allow') {
    return { ok: false, ran: false, url, decision };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, ran: false, url, error: 'invalid URL', decision };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, ran: false, url, error: `unsupported protocol "${parsed.protocol}"`, decision };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = parsed;
    for (let hop = 0; ; hop += 1) {
      const safety = await checkUrlSafety(current);
      if (!safety.safe) {
        return { ok: false, ran: hop > 0, url, error: `blocked by SSRF guard: ${safety.reason}`, decision };
      }
      if (hop > MAX_REDIRECTS) {
        return { ok: false, ran: true, url, error: `too many redirects (>${MAX_REDIRECTS})`, decision };
      }

      const response = await fetch(current, { signal: controller.signal, redirect: 'manual' });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) {
          return {
            ok: false,
            ran: true,
            url,
            status: response.status,
            error: 'redirect with no Location header',
            decision,
          };
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ok: false, ran: true, url, error: `invalid redirect location "${location}"`, decision };
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          return { ok: false, ran: true, url, error: `redirect to unsupported protocol "${next.protocol}"`, decision };
        }
        current = next;
        continue;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const buffer = await response.arrayBuffer();
      const bytes = buffer.byteLength > maxBytes ? buffer.slice(0, maxBytes) : buffer;
      const body = Buffer.from(bytes).toString('utf8');
      if (!response.ok) {
        return { ok: false, ran: true, url, status: response.status, error: `HTTP ${response.status}`, decision };
      }
      if (!contentType.includes('html')) {
        return { ok: true, ran: true, url, status: response.status, text: body, decision };
      }
      const title = extractTitle(body);
      return {
        ok: true,
        ran: true,
        url,
        status: response.status,
        ...(title !== undefined ? { title } : {}),
        text: extractReadableText(body),
        decision,
      };
    }
  } catch (error) {
    return { ok: false, ran: true, url, error: error instanceof Error ? error.message : String(error), decision };
  } finally {
    clearTimeout(timer);
  }
}
