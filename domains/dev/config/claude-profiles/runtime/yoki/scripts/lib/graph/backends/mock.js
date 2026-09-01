'use strict';

/**
 * Mock backend: no process is ever spawned. Returns canned results from the
 * JSON file passed via `--mock <file>`, keyed by `opts.label` (falling back
 * to the raw prompt text as the key when no label was given, matching how
 * every script's own `agent()` calls always pass a label anyway). When the
 * fixture has no entry for a call and a schema was given, synthesizes a
 * placeholder object satisfying `schema.required` (schema.js's
 * `placeholderFor`) instead of failing the run — this is what lets "every
 * script can be exercised offline" hold even for an incomplete fixture.
 */

const fs = require('fs');
const { placeholderFor } = require('../schema');

const name = 'mock';
const supportsSchemaNatively = true; // the fixture/placeholder IS already the object; nothing to enforce

let fixtureCache = new Map(); // mockFile path -> parsed fixture object

function loadFixture(mockFile) {
  if (!mockFile) return {};
  if (fixtureCache.has(mockFile)) return fixtureCache.get(mockFile);
  let data = {};
  if (fs.existsSync(mockFile)) {
    try {
      data = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    } catch (err) {
      throw new Error(`--mock file ${mockFile} is not valid JSON: ${err.message}`);
    }
  }
  fixtureCache.set(mockFile, data);
  return data;
}

/** Exposed for tests to reset the module-level cache between fixtures. */
function clearFixtureCache() {
  fixtureCache = new Map();
}

function buildArgv({ mockFile, label }) {
  // No real argv for a mock call; kept for interface parity with the other
  // three backends (and so a --dry-run / --json trace can show something).
  return { cmd: 'mock', args: ['--mock', mockFile || '(none)', '--label', label || '(none)'] };
}

async function run({ prompt, opts = {}, schema, mockFile }) {
  const fixture = loadFixture(mockFile);
  const key = opts.label || prompt;
  const started = Date.now();
  let value;
  let hit = Object.prototype.hasOwnProperty.call(fixture, key);
  if (hit) {
    value = fixture[key];
  } else if (schema) {
    value = placeholderFor(schema);
  } else {
    value = `[mock:${key}] no fixture entry — placeholder text response`;
  }
  const durationMs = Date.now() - started;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return { raw, durationMs, exitCode: 0, hit };
}

/** The mock backend's "raw" IS already the answer text/JSON — nothing to
 *  unwrap from an envelope. */
function extractText(raw) {
  return raw;
}

module.exports = { name, supportsSchemaNatively, buildArgv, run, extractText, loadFixture, clearFixtureCache };
