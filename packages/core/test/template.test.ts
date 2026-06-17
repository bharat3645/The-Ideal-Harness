import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPlaceholders, renderTemplate } from '../src/skills/template.js';

test('substitutes known placeholders', () => {
  const result = renderTemplate('Hello {{NAME}}, host={{HOST}}', { NAME: 'world', HOST: 'claude' });
  assert.equal(result.text, 'Hello world, host=claude');
  assert.deepEqual(result.missing, []);
});

test('leaves unknown placeholders and reports them in lenient mode', () => {
  const result = renderTemplate('{{A}} {{B}}', { A: '1' });
  assert.equal(result.text, '1 {{B}}');
  assert.deepEqual(result.missing, ['B']);
});

test('throws on missing placeholder in strict mode', () => {
  assert.throws(() => renderTemplate('{{X}}', {}, { strict: true }), /unresolved/);
});

test('findPlaceholders is distinct and order-independent', () => {
  assert.deepEqual(findPlaceholders('{{A}} {{B}} {{A}}').sort(), ['A', 'B']);
});
