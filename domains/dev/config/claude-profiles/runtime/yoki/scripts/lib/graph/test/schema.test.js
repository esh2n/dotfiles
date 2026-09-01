'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractFirstJSONObject, validate, placeholderFor, runWithSchema, SchemaValidationError,
  appendSchemaInstruction,
} = require('../schema');

test('extractFirstJSONObject finds a bare JSON object', () => {
  const obj = extractFirstJSONObject('{"a":1,"b":"two"}');
  assert.deepEqual(obj, { a: 1, b: 'two' });
});

test('extractFirstJSONObject skips prose before/after and handles nested braces', () => {
  const raw = 'Sure, here you go:\n\n{"outer":{"inner":true},"list":[1,2,{"x":3}]}\n\nHope that helps!';
  const obj = extractFirstJSONObject(raw);
  assert.deepEqual(obj, { outer: { inner: true }, list: [1, 2, { x: 3 }] });
});

test('extractFirstJSONObject ignores braces inside JSON string values', () => {
  const raw = '{"note":"a { b } c"}';
  assert.deepEqual(extractFirstJSONObject(raw), { note: 'a { b } c' });
});

test('extractFirstJSONObject returns null when no object is present', () => {
  assert.equal(extractFirstJSONObject('just plain text, no JSON here'), null);
});

test('extractFirstJSONObject skips an unparseable brace run and finds the next one', () => {
  const raw = '{not valid json} then {"ok":true}';
  assert.deepEqual(extractFirstJSONObject(raw), { ok: true });
});

test('validate: required properties', () => {
  const schema = { type: 'object', required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'integer' } } };
  assert.equal(validate({ a: 'x', b: 1 }, schema).ok, true);
  const bad = validate({ a: 'x' }, schema);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /missing required property "b"/);
});

test('validate: type mismatch is reported', () => {
  const schema = { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } };
  const result = validate({ n: 'not a number' }, schema);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /expected type integer/);
});

test('validate: enum', () => {
  const schema = { type: 'string', enum: ['a', 'b', 'c'] };
  assert.equal(validate('b', schema).ok, true);
  assert.equal(validate('z', schema).ok, false);
});

test('validate: nested array of objects, minItems/maxItems', () => {
  const schema = {
    type: 'object', required: ['items'],
    properties: {
      items: {
        type: 'array', minItems: 1, maxItems: 2,
        items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
  };
  assert.equal(validate({ items: [{ id: 'a' }] }, schema).ok, true);
  assert.equal(validate({ items: [] }, schema).ok, false);
  assert.equal(validate({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, schema).ok, false);
  assert.equal(validate({ items: [{}] }, schema).ok, false); // missing nested required id
});

test('validate: minimum/maximum on numbers', () => {
  const schema = { type: 'integer', minimum: 1, maximum: 10 };
  assert.equal(validate(5, schema).ok, true);
  assert.equal(validate(0, schema).ok, false);
  assert.equal(validate(11, schema).ok, false);
});

test('placeholderFor synthesizes an object satisfying required fields', () => {
  const schema = {
    type: 'object',
    required: ['angles'],
    properties: { angles: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
  };
  const placeholder = placeholderFor(schema);
  assert.equal(validate(placeholder, schema).ok, true);
  assert.ok(!('note' in placeholder)); // non-required properties are omitted
});

test('placeholderFor respects enum and nested required', () => {
  const schema = {
    type: 'object', required: ['status', 'inner'],
    properties: {
      status: { type: 'string', enum: ['ok', 'fail'] },
      inner: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  };
  const placeholder = placeholderFor(schema);
  assert.equal(placeholder.status, 'ok');
  assert.equal(validate(placeholder, schema).ok, true);
});

test('appendSchemaInstruction folds the schema into the prompt text', () => {
  const out = appendSchemaInstruction('do the thing', { type: 'object' });
  assert.match(out, /Respond ONLY with JSON matching this schema/);
  assert.match(out, /"type":"object"/);
});

test('runWithSchema: succeeds on the first attempt when output already validates', async () => {
  const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
  let calls = 0;
  const callBackend = async () => { calls += 1; return '{"ok":true}'; };
  const { result, attempts } = await runWithSchema(callBackend, 'p', schema);
  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 1);
  assert.equal(calls, 1);
});

test('runWithSchema: retries once on validation failure, then succeeds', async () => {
  const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
  let calls = 0;
  const callBackend = async (promptText) => {
    calls += 1;
    if (calls === 1) return 'not json at all';
    assert.match(promptText, /did not match the required schema/);
    return '{"ok":false}';
  };
  const { result, attempts } = await runWithSchema(callBackend, 'p', schema);
  assert.deepEqual(result, { ok: false });
  assert.equal(attempts, 2);
  assert.equal(calls, 2);
});

test('runWithSchema: hard-fails after the retry also fails, with raw output attached', async () => {
  const schema = { type: 'object', required: ['ok'] };
  const callBackend = async () => 'still not json';
  await assert.rejects(
    () => runWithSchema(callBackend, 'p', schema),
    (err) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.equal(err.raw, 'still not json');
      return true;
    },
  );
});

test('runWithSchema: nativeSchema=true skips the append-instruction step but still validates', async () => {
  const schema = { type: 'object', required: ['ok'] };
  let seenPrompt;
  const callBackend = async (promptText) => { seenPrompt = promptText; return '{"ok":true}'; };
  await runWithSchema(callBackend, 'plain prompt', schema, { nativeSchema: true });
  assert.equal(seenPrompt, 'plain prompt'); // no "Respond ONLY with JSON..." text appended
});
