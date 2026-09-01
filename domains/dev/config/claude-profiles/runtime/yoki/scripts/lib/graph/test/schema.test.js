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

// ---------------------------------------------------------------------------
// toStrictJsonSchema / stripNullOptionals — the loose->strict conversion the
// codex backend puts on the wire while validation stays on the loose schema.
// ---------------------------------------------------------------------------

const { toStrictJsonSchema, stripNullOptionals } = require('../schema');

test('toStrictJsonSchema closes every object and requires every property', () => {
  const loose = {
    type: 'object',
    required: ['verdict'],
    properties: {
      verdict: { type: 'string', enum: ['pass', 'fail'] },
      note: { type: 'string' },
    },
  };
  const strict = toStrictJsonSchema(loose);
  assert.equal(strict.additionalProperties, false);
  assert.deepEqual(strict.required, ['verdict', 'note']);
  // A property that was genuinely required keeps its exact shape...
  assert.deepEqual(strict.properties.verdict, { type: 'string', enum: ['pass', 'fail'] });
  // ...and one that was optional becomes nullable, so "required" costs the
  // caller nothing semantically.
  assert.deepEqual(strict.properties.note.type, ['string', 'null']);
  // The caller's own schema is untouched.
  assert.deepEqual(loose.required, ['verdict']);
  assert.equal(loose.properties.note.type, 'string');
});

test('toStrictJsonSchema recurses through properties and array items', () => {
  const strict = toStrictJsonSchema({
    type: 'object',
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['file'],
          properties: { file: { type: 'string' }, line: { type: 'integer' } },
        },
      },
      meta: { type: 'object', properties: { runId: { type: 'string' } } },
    },
  });
  const item = strict.properties.findings.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ['file', 'line']);
  assert.deepEqual(item.properties.line.type, ['integer', 'null']);
  // A nested object that was itself optional is nullable AND strict inside.
  const meta = strict.properties.meta;
  assert.ok(meta.type.includes('null'));
  assert.equal(meta.additionalProperties, false);
  assert.deepEqual(meta.required, ['runId']);
});

test('toStrictJsonSchema widens an optional enum to accept null too', () => {
  // type: [X, 'null'] with an enum that still lists only the original values
  // is a schema nothing can satisfy with null.
  const strict = toStrictJsonSchema({
    type: 'object',
    properties: { severity: { type: 'string', enum: ['low', 'high'] } },
  });
  assert.deepEqual(strict.properties.severity.enum, ['low', 'high', null]);
  assert.deepEqual(strict.properties.severity.type, ['string', 'null']);
});

test('toStrictJsonSchema keeps a schema-valued additionalProperties instead of forcing false', () => {
  // Forcing `false` here would silently restrict the model to `{}`.
  const strict = toStrictJsonSchema({ type: 'object', additionalProperties: { type: 'string' } });
  assert.deepEqual(strict.additionalProperties, { type: 'string' });
});

test('toStrictJsonSchema treats $defs as a map of subschemas, not as a node', () => {
  const strict = toStrictJsonSchema({
    type: 'object',
    required: ['x'],
    properties: { x: { $ref: '#/$defs/thing' } },
    $defs: { thing: { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } } } },
  });
  assert.ok(Object.prototype.hasOwnProperty.call(strict.$defs, 'thing'));
  assert.deepEqual(strict.$defs.thing.required, ['a', 'b']);
  assert.equal(strict.$defs.thing.additionalProperties, false);
});

test('stripNullOptionals removes nulled optional properties but keeps required ones', () => {
  const schema = {
    type: 'object',
    required: ['verdict'],
    properties: { verdict: { type: 'string' }, note: { type: 'string' } },
  };
  assert.deepEqual(stripNullOptionals({ verdict: 'pass', note: null }, schema), { verdict: 'pass' });
  // A null in a REQUIRED property is a real validation failure and must survive.
  assert.deepEqual(stripNullOptionals({ verdict: null }, schema), { verdict: null });
});

test('runWithSchema accepts a strict-mode answer whose optional fields came back null', () => {
  const schema = {
    type: 'object',
    required: ['verdict'],
    properties: { verdict: { type: 'string' }, note: { type: 'string' } },
  };
  let attempts = 0;
  const callBackend = async () => { attempts += 1; return '{"verdict":"pass","note":null}'; };
  return runWithSchema(callBackend, 'p', schema, { nativeSchema: true }).then((outcome) => {
    assert.equal(attempts, 1, 'a nulled optional must not cost a retry');
    assert.deepEqual(outcome.result, { verdict: 'pass' });
  });
});
