/**
 * High-level `/browse` actions over a `CdpSession` — navigate, snapshot,
 * click, type, screenshot, evaluate. Scoped honestly, not to
 * `chrome-devtools-mcp` feature parity:
 *
 *   - `snapshot` walks the live DOM via `Runtime.evaluate` and tags
 *     interactive/labeled elements with a `data-ih-uid` attribute, rather
 *     than rendering the full CDP `Accessibility` domain's AX-tree graph.
 *     Simpler, reliably testable, and produces the same practical result
 *     (a stable-uid list of what's on the page) — not the fuller
 *     accessibility-role tree `chrome-devtools-mcp` itself builds.
 *   - `click`/`type` dispatch through the same injected script (`.click()`,
 *     set `.value` + a real `input`/`change` event) rather than synthesizing
 *     OS-level `Input.dispatchMouseEvent`/key events. Works for ordinary web
 *     content; won't fool a listener that specifically requires a native
 *     input event (e.g. some anti-bot checks) — stated here, not hidden.
 */

import type { CdpSession } from './cdp.js';

export interface SnapshotElement {
  readonly uid: string;
  readonly tag: string;
  readonly role: string | null;
  readonly text: string;
  readonly href: string | null;
  readonly disabled: boolean;
}

const SNAPSHOT_SCRIPT = `(() => {
  const SELECTOR = 'a[href], button, input, select, textarea, [role], [onclick], [tabindex]:not([tabindex="-1"])';
  const nodes = Array.from(document.querySelectorAll(SELECTOR));
  return nodes.slice(0, 500).map((el, i) => {
    const uid = 'ih' + i;
    el.setAttribute('data-ih-uid', uid);
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || '').trim().slice(0, 120);
    return {
      uid,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      text,
      href: el.getAttribute('href'),
      disabled: !!(el.disabled),
    };
  });
})()`;

async function evalJson<T>(session: CdpSession, expression: string): Promise<T> {
  const result = await session.send<{
    result: { value?: T; description?: string };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(
      `page script threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
    );
  }
  return result.result.value as T;
}

export async function navigate(session: CdpSession, url: string, timeoutMs = 15000): Promise<{ url: string }> {
  await session.send('Page.enable');
  await session.send('Page.navigate', { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyState = await evalJson<string>(session, 'document.readyState');
    if (readyState === 'complete') {
      const finalUrl = await evalJson<string>(session, 'location.href');
      return { url: finalUrl };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`navigation to ${url} did not reach readyState=complete within ${timeoutMs}ms`);
}

export async function snapshot(session: CdpSession): Promise<readonly SnapshotElement[]> {
  return evalJson<SnapshotElement[]>(session, SNAPSHOT_SCRIPT);
}

export async function click(session: CdpSession, uid: string): Promise<void> {
  const ok = await evalJson<boolean>(
    session,
    `(() => { const el = document.querySelector('[data-ih-uid="${uid}"]'); if (!el) return false; el.click(); return true; })()`,
  );
  if (!ok) {
    throw new Error(`no element with uid "${uid}" — call snapshot first, uids don't survive navigation`);
  }
}

export async function typeText(session: CdpSession, uid: string, text: string): Promise<void> {
  const encoded = JSON.stringify(text);
  const ok = await evalJson<boolean>(
    session,
    `(() => {
      const el = document.querySelector('[data-ih-uid="${uid}"]');
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) { setter.call(el, ${encoded}); } else { el.value = ${encoded}; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
  if (!ok) {
    throw new Error(`no element with uid "${uid}" — call snapshot first, uids don't survive navigation`);
  }
}

export async function screenshot(session: CdpSession): Promise<{ base64Png: string }> {
  const result = await session.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  return { base64Png: result.data };
}

export async function evaluate(session: CdpSession, expression: string): Promise<unknown> {
  return evalJson(session, expression);
}
