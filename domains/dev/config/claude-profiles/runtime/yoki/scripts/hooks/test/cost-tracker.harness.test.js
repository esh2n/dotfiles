'use strict';

// Cost-tracker cross-harness regression test (#T17).
//
// cost-tracker.js has no `run()` export (it's a legacy stdin-driven script),
// so it's exercised the same way as run-bash-hook.test.js exercises
// git-guard.sh: spawn the real script, feed it a Stop-shaped payload on
// stdin, and read back the row it appended to costs.jsonl under an isolated
// YOKI_AGENT_DATA_HOME. Claude behaviour must stay byte-identical (see
// core/validation/test-suggest-compact.sh for the parallel guarantee on the
// suggest-compact hook); these tests pin the exact Claude row shape as the
// regression anchor, then verify codex/omp both produce a row with the added
// `harness` field and the model taken from the payload.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'cost-tracker.js');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// Runs cost-tracker.js against `input` under its own isolated
// YOKI_AGENT_DATA_HOME (so costs.jsonl never touches the real metrics log),
// returning the child process result plus every row it appended.
function runCostTracker(input, extraEnv) {
  return withTempDir('yoki-cost-tracker-', (dataHome) => {
    const result = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: Object.assign({}, process.env, { YOKI_AGENT_DATA_HOME: dataHome }, extraEnv || {}),
    });

    const rowsFile = path.join(dataHome, 'metrics', 'costs.jsonl');
    let rows = [];
    if (fs.existsSync(rowsFile)) {
      rows = fs
        .readFileSync(rowsFile, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    }
    return { result, rows };
  });
}

// ---------------------------------------------------------------------------
// claude: byte-identical (no YOKI_HARNESS — matches production, where
// run-with-flags never sets it for the Claude path)
// ---------------------------------------------------------------------------

test('claude: sums every assistant turn in the transcript into one row (unchanged behavior)', () => {
  withTempDir('yoki-cost-claude-', (dir) => {
    const transcriptPath = path.join(dir, 'transcript.jsonl');
    writeJsonl(transcriptPath, [
      { type: 'assistant', message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'assistant', message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    ]);

    const { result, rows } = runCostTracker({
      session_id: 'claude-sess-1',
      transcript_path: transcriptPath,
      hook_event_name: 'Stop',
    });

    assert.equal(result.status, 0, `expected exit 0: stderr=${result.stderr}`);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.harness, 'claude');
    assert.equal(row.model, 'claude-sonnet-4-5');
    assert.equal(row.input_tokens, 150);
    assert.equal(row.output_tokens, 15);
    assert.equal(row.cache_write_tokens, 0);
    assert.equal(row.cache_read_tokens, 0);
    // sonnet rates: (150/1e6)*3 + (15/1e6)*15 = 0.00045 + 0.000225
    assert.equal(row.estimated_cost_usd, 0.000675);
    assert.equal(row.session_id, 'claude-sess-1');
    assert.equal(row.transcript_path, transcriptPath);
  });
});

test('claude: no transcript writes a zero-filled row (unchanged pre-existing behavior), stdin still passed through', () => {
  const { result, rows } = runCostTracker({ session_id: 'claude-sess-none', hook_event_name: 'Stop' });
  assert.equal(result.status, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].harness, 'claude');
  assert.equal(rows[0].model, 'unknown');
  assert.equal(rows[0].input_tokens, 0);
  assert.equal(rows[0].estimated_cost_usd, 0);
  assert.equal(JSON.parse(result.stdout).session_id, 'claude-sess-none');
});

// ---------------------------------------------------------------------------
// codex: cumulative total_token_usage (not the per-turn last_token_usage),
// model preferred from the payload, price null for an unpriced model id
// ---------------------------------------------------------------------------

test('codex: reads the newest total_token_usage as the cumulative session total', () => {
  withTempDir('yoki-cost-codex-', (dir) => {
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    writeJsonl(rolloutPath, [
      { type: 'session_meta', payload: { session_id: 'x' } },
      { type: 'turn_context', payload: { model: 'gpt-5.1-codex-max' } },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 14163, cached_input_tokens: 11008, cache_write_input_tokens: 0, output_tokens: 115 },
            last_token_usage: { input_tokens: 14163, cached_input_tokens: 11008, cache_write_input_tokens: 0, output_tokens: 115 },
          },
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 28466, cached_input_tokens: 24064, cache_write_input_tokens: 0, output_tokens: 120 },
            // per-turn delta only — must NOT be what the row reports
            last_token_usage: { input_tokens: 14303, cached_input_tokens: 13056, cache_write_input_tokens: 0, output_tokens: 5 },
          },
        },
      },
    ]);

    const { result, rows } = runCostTracker(
      {
        session_id: 'codex-sess-1',
        transcript_path: rolloutPath,
        hook_event_name: 'Stop',
        model: 'gpt-5.1-codex-max',
      },
      { YOKI_HARNESS: 'codex' }
    );

    assert.equal(result.status, 0, `expected exit 0: stderr=${result.stderr}`);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.harness, 'codex');
    assert.equal(row.model, 'gpt-5.1-codex-max');
    assert.equal(row.input_tokens, 28466);
    assert.equal(row.output_tokens, 120);
    assert.equal(row.cache_read_tokens, 24064);
    assert.equal(row.cache_write_tokens, 0);
    // gpt-5.1-codex-max has no known price in lib/cost-estimate.js -> null,
    // never NaN.
    assert.equal(row.estimated_cost_usd, null);
  });
});

test('codex: unrecognized model id still prices as null, never NaN', () => {
  withTempDir('yoki-cost-codex-unknown-', (dir) => {
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    writeJsonl(rolloutPath, [
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10 } } } },
    ]);

    const { rows } = runCostTracker(
      { session_id: 'codex-sess-unknown', transcript_path: rolloutPath, hook_event_name: 'Stop', model: 'gpt-9000-mystery' },
      { YOKI_HARNESS: 'codex' }
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].model, 'gpt-9000-mystery');
    assert.equal(rows[0].estimated_cost_usd, null);
    assert.notEqual(rows[0].estimated_cost_usd, NaN); // sanity: null !== NaN, but spell it out
    assert.equal(Number.isNaN(rows[0].estimated_cost_usd), false);
  });
});

// ---------------------------------------------------------------------------
// omp: sums every assistant message's per-turn usage delta, prices via the
// harness's own model id (an Anthropic model routed through omp)
// ---------------------------------------------------------------------------

test('omp: sums every assistant message usage delta into one row', () => {
  withTempDir('yoki-cost-omp-', (dir) => {
    const sessionFilePath = path.join(dir, 'session.jsonl');
    writeJsonl(sessionFilePath, [
      { type: 'title', message: { text: 'a session' } },
      { type: 'message', message: { role: 'user', content: 'do the thing' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          model: 'anthropic/claude-fable-5',
          usage: { input: 26757, output: 183, cacheRead: 0, cacheWrite: 0, totalTokens: 26940 },
        },
      },
      { type: 'message', message: { role: 'toolResult', content: 'ok' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          model: 'anthropic/claude-fable-5',
          usage: { input: 1064, output: 29, cacheRead: 26112, cacheWrite: 0, totalTokens: 27205 },
        },
      },
    ]);

    const { result, rows } = runCostTracker(
      {
        session_id: 'omp-sess-1',
        transcript_path: sessionFilePath,
        hook_event_name: 'Stop',
        model: 'anthropic/claude-fable-5',
      },
      { YOKI_HARNESS: 'omp' }
    );

    assert.equal(result.status, 0, `expected exit 0: stderr=${result.stderr}`);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.harness, 'omp');
    assert.equal(row.model, 'anthropic/claude-fable-5');
    assert.equal(row.input_tokens, 26757 + 1064);
    assert.equal(row.output_tokens, 183 + 29);
    assert.equal(row.cache_read_tokens, 26112);
    assert.equal(row.cache_write_tokens, 0);
    // anthropic/claude-fable-5 maps to the opus tier's known rates in
    // lib/cost-estimate.js: (27821/1e6)*15 + (212/1e6)*75
    assert.equal(row.estimated_cost_usd, 0.433215);
  });
});

test('omp: unrecognized model id prices as null', () => {
  withTempDir('yoki-cost-omp-unknown-', (dir) => {
    const sessionFilePath = path.join(dir, 'session.jsonl');
    writeJsonl(sessionFilePath, [
      { type: 'message', message: { role: 'assistant', model: 'some/other-model', usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0 } } },
    ]);

    const { rows } = runCostTracker(
      { session_id: 'omp-sess-unknown', transcript_path: sessionFilePath, hook_event_name: 'Stop', model: 'some/other-model' },
      { YOKI_HARNESS: 'omp' }
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].estimated_cost_usd, null);
  });
});
