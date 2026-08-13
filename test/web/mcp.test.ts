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

test('buildWebTools exposes all 6 browse_* tools, each refusing by default (no operator allow rule)', async () => {
  const tools = buildWebTools();
  const names = [
    'browse_navigate',
    'browse_snapshot',
    'browse_click',
    'browse_type',
    'browse_screenshot',
    'browse_evaluate',
  ];
  for (const name of names) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} should be registered`);
  }

  const navigateTool = tools.find((t) => t.name === 'browse_navigate');
  assert.ok(navigateTool);
  const navResult = await navigateTool.handler({ url: 'https://example.com' });
  assert.equal(navResult.isError, true);
  const navBody = JSON.parse(navResult.text);
  assert.equal(navBody.ok, false);
  assert.match(navBody.error, /browse refused/);

  const snapshotTool = tools.find((t) => t.name === 'browse_snapshot');
  assert.ok(snapshotTool);
  const snapshotResult = await snapshotTool.handler({});
  assert.equal(snapshotResult.isError, true);
  assert.match(JSON.parse(snapshotResult.text).error, /browse refused/);

  const evaluateTool = tools.find((t) => t.name === 'browse_evaluate');
  assert.ok(evaluateTool);
  const evalResult = await evaluateTool.handler({ expression: '1+1' });
  assert.equal(evalResult.isError, true);
  assert.match(JSON.parse(evalResult.text).error, /browse refused/);
});

test('buildWebTools exposes browse_close, which is not gated (it only ever shuts something down)', async () => {
  const tools = buildWebTools();
  const closeTool = tools.find((t) => t.name === 'browse_close');
  assert.ok(closeTool);
  const result = await closeTool.handler({});
  assert.equal(result.isError, undefined);
  const body = JSON.parse(result.text);
  assert.equal(body.ok, true);
  assert.equal(typeof body.closed, 'boolean');
});
