import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWebTools } from '../../src/web/runtime/mcp.js';

test('buildWebTools exposes web_fetch and web_docs, both refusing by default (no operator allow rule)', async () => {
  const tools = buildWebTools();
  const fetchTool = tools.find((t) => t.name === 'web_fetch');
  const docsTool = tools.find((t) => t.name === 'web_docs');
  assert.ok(fetchTool);
  assert.ok(docsTool);

  const fetchResult = await fetchTool.handler({ url: 'https://example.com' });
  assert.equal(fetchResult.isError, true);
  const fetchBody = JSON.parse(fetchResult.text);
  assert.equal(fetchBody.ran, false);

  const docsResult = await docsTool.handler({ name: 'lodash' });
  assert.equal(docsResult.isError, true);
  const docsBody = JSON.parse(docsResult.text);
  assert.equal(docsBody.ran, false);
});
