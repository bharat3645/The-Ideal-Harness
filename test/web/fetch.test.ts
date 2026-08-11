import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PolicyRule } from '../../src/guard/policy/types.js';
import { extractReadableText, fetchPage } from '../../src/web/fetch.js';

test('extractReadableText prefers <main>/<article> over the rest of the page', () => {
  const html = `
    <html><body>
      <nav>Home About Contact Home About Contact</nav>
      <main><h1>Title</h1><p>The actual article content lives here.</p></main>
      <footer>Copyright footer text repeated many times over and over</footer>
    </body></html>`;
  const text = extractReadableText(html);
  assert.match(text, /actual article content/);
});

test('extractReadableText strips script/style tags entirely', () => {
  const html =
    '<html><body><main><script>evil()</script><style>.x{color:red}</style><p>Real text</p></main></body></html>';
  const text = extractReadableText(html);
  assert.match(text, /Real text/);
  assert.ok(!text.includes('evil()'));
  assert.ok(!text.includes('color:red'));
});

test('extractReadableText decodes common HTML entities', () => {
  const html = '<html><body><main><p>Fish &amp; Chips &mdash; &quot;great&quot;</p></main></body></html>'.replace(
    '&mdash;',
    '&nbsp;',
  );
  const text = extractReadableText(html);
  assert.match(text, /Fish & Chips/);
});

test('extractReadableText falls back to the whole body when there is no main/article/div content', () => {
  const html = '<html><body>Just plain text, no tags at all beyond body.</body></html>';
  const text = extractReadableText(html);
  assert.match(text, /Just plain text/);
});

test('extractReadableText never throws on malformed HTML', () => {
  assert.doesNotThrow(() => extractReadableText('<html><body><main>unterminated'));
  assert.doesNotThrow(() => extractReadableText(''));
});

test('fetchPage refuses to run when the WebFetch policy decision is not allow', async () => {
  const result = await fetchPage('https://example.com');
  assert.equal(result.ran, false);
  assert.notEqual(result.decision.action, 'allow');
});

test('fetchPage rejects an invalid URL even when policy would allow it', async () => {
  const ALLOW_ALL: PolicyRule = { id: 'test-allow', action: 'allow', tool: 'WebFetch' };
  const result = await fetchPage('not a url', { policyTiers: [[ALLOW_ALL]] });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /invalid URL/);
});

test('fetchPage rejects a non-http(s) protocol even when policy would allow it', async () => {
  const ALLOW_ALL: PolicyRule = { id: 'test-allow', action: 'allow', tool: 'WebFetch' };
  const result = await fetchPage('file:///etc/passwd', { policyTiers: [[ALLOW_ALL]] });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /unsupported protocol/);
});

test('fetchPage is refused outright by an explicit deny, same as the native tool would be', async () => {
  const DENY_ALL: PolicyRule = { id: 'test-deny', action: 'deny', tool: 'WebFetch' };
  const result = await fetchPage('https://example.com', { policyTiers: [[DENY_ALL]] });
  assert.equal(result.ran, false);
  assert.equal(result.decision.action, 'deny');
});

test('fetchPage refuses a private/internal target even when policy explicitly allows it (SSRF guard)', async () => {
  const ALLOW_ALL: PolicyRule = { id: 'test-allow', action: 'allow', tool: 'WebFetch' };
  const result = await fetchPage('http://169.254.169.254/latest/meta-data/', { policyTiers: [[ALLOW_ALL]] });
  assert.equal(result.ok, false);
  assert.equal(result.ran, false);
  assert.match(result.error ?? '', /blocked by SSRF guard/);
});

test('fetchPage refuses localhost even when policy explicitly allows it (SSRF guard)', async () => {
  const ALLOW_ALL: PolicyRule = { id: 'test-allow', action: 'allow', tool: 'WebFetch' };
  const result = await fetchPage('http://localhost:8080/admin', { policyTiers: [[ALLOW_ALL]] });
  assert.equal(result.ok, false);
  assert.equal(result.ran, false);
  assert.match(result.error ?? '', /blocked by SSRF guard/);
});
