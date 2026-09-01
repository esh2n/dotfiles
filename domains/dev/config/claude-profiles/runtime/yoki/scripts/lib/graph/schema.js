'use strict';

/**
 * JSON-schema enforcement for backends that cannot force structured output
 * themselves (or whose native structured-output flag still needs a safety
 * net). See API.md's `agent()` schema section for the contract.
 *
 * Flow: append a "respond ONLY with JSON matching this schema" instruction
 * to the prompt (skipped when the backend already enforces the schema
 * natively — see backends/*.js `supportsSchemaNatively`), extract the first
 * JSON object from the raw output, validate it against the schema, and on
 * failure retry ONCE with the validation error folded into the prompt.
 * Failing that, hard-fail (throw) with the raw output attached so the
 * journal can record it.
 */

class SchemaValidationError extends Error {
  constructor(message, { raw, errors } = {}) {
    super(message);
    this.name = 'SchemaValidationError';
    this.raw = raw;
    this.errors = errors || [];
  }
}

/** Append the "respond only with JSON" instruction schema.js is responsible for. */
function appendSchemaInstruction(prompt, schema) {
  return `${prompt}\n\nRespond ONLY with JSON matching this schema: ${JSON.stringify(schema)}`;
}

/** Fold a failed validation's errors into a follow-up prompt for the retry. */
function appendRetryInstruction(prompt, schema, errors) {
  return `${prompt}\n\nYour previous response did not match the required schema. Problems: ${errors.join('; ')}\nRespond ONLY with corrected JSON matching this schema: ${JSON.stringify(schema)}`;
}

/**
 * Scan `text` for the first syntactically-balanced `{...}` and JSON.parse it.
 * Handles strings/escapes/braces-inside-strings so a JSON value containing
 * `}` in a string doesn't terminate the scan early. Also tolerates markdown
 * fenced code blocks (```json ... ```) by starting the scan after the fence.
 */
function extractFirstJSONObject(text) {
  if (typeof text !== 'string' || !text.length) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;

  for (let from = start; from !== -1; from = text.indexOf('{', from + 1)) {
    const candidate = scanBalancedObject(text, from);
    if (candidate === null) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // not valid JSON at this brace — keep scanning for another '{'
    }
  }
  return null;
}

function scanBalancedObject(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Small hand-written recursive JSON-schema validator: required/type/enum,
 *  plus properties/items/minimum/maximum/minItems/maxItems — everything
 *  this repo's own workflow scripts actually declare in a schema. */
function validate(value, schema, path = '$') {
  const errors = [];
  walk(value, schema, path, errors);
  return { ok: errors.length === 0, errors };
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'number' | 'string' | 'boolean' | 'object' | 'undefined'
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === 'integer') return actual === 'integer';
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function walk(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.enum && !schema.enum.some((v) => deepEqual(v, value))) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${typeOf(value)}`);
      return; // further structural checks are meaningless on a type mismatch
    }
  }

  if (schema.type === 'object' || (!schema.type && schema.properties)) {
    if (typeOf(value) !== 'object') {
      errors.push(`${path}: expected object, got ${typeOf(value)}`);
      return;
    }
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        walk(value[key], propSchema, `${path}.${key}`, errors);
      }
    }
  }

  if (schema.type === 'array' || (!schema.type && schema.items)) {
    if (typeOf(value) !== 'array') {
      errors.push(`${path}: expected array, got ${typeOf(value)}`);
      return;
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: array has ${value.length} item(s), needs >= ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: array has ${value.length} item(s), needs <= ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => walk(item, schema.items, `${path}[${i}]`, errors));
    }
  }

  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
    }
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Build a placeholder object that satisfies `schema.required` (used by the
 * mock backend's fallback when a fixture has no entry for a label). Every
 * required property gets a type-appropriate placeholder; nested
 * required/properties are honored recursively.
 */
function placeholderFor(schema) {
  if (!schema || typeof schema !== 'object') return {};
  const type = schema.type || (schema.properties ? 'object' : schema.items ? 'array' : 'string');
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  switch (type) {
    case 'object': {
      const obj = {};
      for (const key of schema.required || []) {
        obj[key] = placeholderFor((schema.properties || {})[key] || { type: 'string' });
      }
      return obj;
    }
    case 'array':
      return [];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return 'placeholder';
  }
}

/**
 * Run the append/extract/validate/retry-once/hard-fail pipeline.
 *
 * @param {(promptText: string, attempt: number) => Promise<string>} callBackend
 *   invoked once per attempt (max 2) with the (possibly schema-augmented,
 *   possibly retry-augmented) prompt text; must resolve to the backend's raw
 *   text output for that attempt.
 * @param {string} prompt original prompt
 * @param {object} schema JSON schema the final object must satisfy
 * @param {{ nativeSchema?: boolean }} [opts] when nativeSchema is true the
 *   backend already enforces the schema itself (e.g. claude --json-schema,
 *   codex --output-schema) — the prompt is NOT augmented with the
 *   instruction text, but the output is still parsed and validated as a
 *   safety net, and a validation failure still retries once.
 */
async function runWithSchema(callBackend, prompt, schema, opts = {}) {
  let promptText = opts.nativeSchema ? prompt : appendSchemaInstruction(prompt, schema);
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await callBackend(promptText, attempt);
    lastRaw = raw;
    const obj = extractFirstJSONObject(raw);
    const { ok, errors } = obj !== null
      ? validate(obj, schema)
      : { ok: false, errors: ['no JSON object found in output'] };
    if (ok) return { result: obj, raw, attempts: attempt + 1 };
    promptText = opts.nativeSchema
      ? `${prompt}\n\n(Previous attempt failed validation: ${errors.join('; ')})`
      : appendRetryInstruction(prompt, schema, errors);
    if (attempt === 1) {
      throw new SchemaValidationError(`schema validation failed after retry: ${errors.join('; ')}`, { raw: lastRaw, errors });
    }
  }
  // unreachable, but keeps control-flow analysis happy
  throw new SchemaValidationError('schema validation failed', { raw: lastRaw, errors: [] });
}

module.exports = {
  SchemaValidationError,
  appendSchemaInstruction,
  appendRetryInstruction,
  extractFirstJSONObject,
  validate,
  placeholderFor,
  runWithSchema,
};
