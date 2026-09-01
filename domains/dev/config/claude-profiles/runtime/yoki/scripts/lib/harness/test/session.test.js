'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveSessionFile, readUsage } = require('../session');

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// resolveSessionFile
// ---------------------------------------------------------------------------

test('resolveSessionFile: claude returns transcript_path verbatim', () => {
  const result = resolveSessionFile({ transcript_path: '/x/claude.jsonl' }, 'claude', {});
  assert.equal(result, '/x/claude.jsonl');
});

test('resolveSessionFile: claude with no transcript_path is null', () => {
  const result = resolveSessionFile({}, 'claude', {});
  assert.equal(result, null);
});

test('resolveSessionFile: omp returns transcript_path verbatim (= session_file from the bridge)', () => {
  const result = resolveSessionFile({ transcript_path: '/x/omp-session.jsonl' }, 'omp', {});
  assert.equal(result, '/x/omp-session.jsonl');
});

test('resolveSessionFile: omp with no transcript_path is null', () => {
  const result = resolveSessionFile({}, 'omp', {});
  assert.equal(result, null);
});

test('resolveSessionFile: codex uses transcript_path when present', () => {
  const result = resolveSessionFile(
    { transcript_path: '/x/rollout-2026-01-01T00-00-00-abc.jsonl', session_id: 'abc' },
    'codex',
    {}
  );
  assert.equal(result, '/x/rollout-2026-01-01T00-00-00-abc.jsonl');
});

test('resolveSessionFile: codex falls back to a CODEX_HOME session-id lookup', () => {
  withTempDir('yoki-session-codex-', (codexHome) => {
    const sessionId = '01a05683-d934-7703-941b-f75053a7f8a8';
    const rolloutPath = path.join(
      codexHome,
      'sessions',
      '2026',
      '08',
      '31',
      `rollout-2026-08-31T15-31-16-${sessionId}.jsonl`
    );
    writeJsonl(rolloutPath, [{ type: 'session_meta', payload: { session_id: sessionId } }]);

    const result = resolveSessionFile({ session_id: sessionId }, 'codex', { CODEX_HOME: codexHome });
    assert.equal(result, rolloutPath);
  });
});

test('resolveSessionFile: codex lookup walks multiple days newest-first and finds the right one', () => {
  withTempDir('yoki-session-codex-multi-', (codexHome) => {
    const olderId = '01a05680-0000-0000-0000-000000000000';
    const newerId = '01a05683-d934-7703-941b-f75053a7f8a8';

    const olderPath = path.join(codexHome, 'sessions', '2026', '08', '29', `rollout-2026-08-29T10-00-00-${olderId}.jsonl`);
    const newerPath = path.join(codexHome, 'sessions', '2026', '08', '31', `rollout-2026-08-31T15-31-16-${newerId}.jsonl`);
    writeJsonl(olderPath, [{ type: 'session_meta', payload: { session_id: olderId } }]);
    writeJsonl(newerPath, [{ type: 'session_meta', payload: { session_id: newerId } }]);

    const result = resolveSessionFile({ session_id: newerId }, 'codex', { CODEX_HOME: codexHome });
    assert.equal(result, newerPath);
  });
});

test('resolveSessionFile: codex lookup with no matching session_id is null', () => {
  withTempDir('yoki-session-codex-missing-', (codexHome) => {
    const rolloutPath = path.join(codexHome, 'sessions', '2026', '08', '31', 'rollout-2026-08-31T15-31-16-some-other-id.jsonl');
    writeJsonl(rolloutPath, [{ type: 'session_meta', payload: { session_id: 'some-other-id' } }]);

    const result = resolveSessionFile({ session_id: 'no-such-session' }, 'codex', { CODEX_HOME: codexHome });
    assert.equal(result, null);
  });
});

test('resolveSessionFile: codex lookup against a CODEX_HOME with no sessions dir is null', () => {
  withTempDir('yoki-session-codex-empty-', (codexHome) => {
    const result = resolveSessionFile({ session_id: 'anything' }, 'codex', { CODEX_HOME: codexHome });
    assert.equal(result, null);
  });
});

test('resolveSessionFile: unknown harness with no transcript_path is null', () => {
  const result = resolveSessionFile({ session_id: 'x' }, 'unknown-harness', {});
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// readUsage: claude
// ---------------------------------------------------------------------------

test('readUsage: claude reads the newest usage record', () => {
  withTempDir('yoki-usage-claude-', (dir) => {
    const filePath = path.join(dir, 'transcript.jsonl');
    writeJsonl(filePath, [
      { message: { model: 'claude-old', usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10 } } },
      { message: { model: 'claude-sonnet-4[1m]', usage: { input_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300, output_tokens: 40 } } },
    ]);

    const result = readUsage(filePath, 'claude');
    assert.deepEqual(result, {
      inputTokens: 500,
      outputTokens: 40,
      cacheRead: 2000,
      cacheWrite: 300,
      model: 'claude-sonnet-4[1m]',
      contextTokens: 2800,
    });
  });
});

test('readUsage: claude with no usage records is null', () => {
  withTempDir('yoki-usage-claude-none-', (dir) => {
    const filePath = path.join(dir, 'transcript.jsonl');
    writeJsonl(filePath, [{ message: { role: 'user', content: 'hi' } }]);

    assert.equal(readUsage(filePath, 'claude'), null);
  });
});

// ---------------------------------------------------------------------------
// readUsage: codex
// ---------------------------------------------------------------------------

test('readUsage: codex reads the newest token_count and pairs it with the active model', () => {
  withTempDir('yoki-usage-codex-', (dir) => {
    const filePath = path.join(dir, 'rollout.jsonl');
    writeJsonl(filePath, [
      { type: 'session_meta', payload: { session_id: 'x' } },
      { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 9999, cached_input_tokens: 9999, cache_write_input_tokens: 0, output_tokens: 999, total_tokens: 9999 },
            last_token_usage: { input_tokens: 14031, cached_input_tokens: 11008, cache_write_input_tokens: 0, output_tokens: 240, total_tokens: 14271 },
            model_context_window: 258400,
          },
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 28560, cached_input_tokens: 24064, cache_write_input_tokens: 0, output_tokens: 282, total_tokens: 28842 },
            last_token_usage: { input_tokens: 14529, cached_input_tokens: 13056, cache_write_input_tokens: 0, output_tokens: 42, total_tokens: 14571 },
            model_context_window: 258400,
          },
        },
      },
    ]);

    const result = readUsage(filePath, 'codex');
    assert.deepEqual(result, {
      inputTokens: 14529,
      outputTokens: 42,
      cacheRead: 13056,
      cacheWrite: 0,
      model: 'gpt-5.6-sol',
      contextTokens: 27585,
    });
  });
});

test('readUsage: codex rollout with no token_count record is null (older/aborted sessions)', () => {
  withTempDir('yoki-usage-codex-none-', (dir) => {
    const filePath = path.join(dir, 'rollout.jsonl');
    writeJsonl(filePath, [
      { type: 'session_meta', payload: { session_id: 'x' } },
      { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    ]);

    assert.equal(readUsage(filePath, 'codex'), null);
  });
});

// ---------------------------------------------------------------------------
// readUsage: omp
// ---------------------------------------------------------------------------

test('readUsage: omp reads the newest assistant message entry', () => {
  withTempDir('yoki-usage-omp-', (dir) => {
    const filePath = path.join(dir, 'session.jsonl');
    writeJsonl(filePath, [
      { type: 'title', message: { text: 'a session' } },
      { type: 'message', message: { role: 'user', content: 'do the thing' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          model: 'gpt-5.4-mini',
          usage: { input: 26757, output: 183, cacheRead: 0, cacheWrite: 0, totalTokens: 26940, reasoningTokens: 96 },
        },
      },
      { type: 'message', message: { role: 'toolResult', content: 'ok' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          model: 'gpt-5.4-mini',
          usage: { input: 1064, output: 29, cacheRead: 26112, cacheWrite: 0, totalTokens: 27205 },
        },
      },
    ]);

    const result = readUsage(filePath, 'omp');
    assert.deepEqual(result, {
      inputTokens: 1064,
      outputTokens: 29,
      cacheRead: 26112,
      cacheWrite: 0,
      model: 'gpt-5.4-mini',
      contextTokens: 27176,
    });
  });
});

test('readUsage: omp with no assistant message entries is null', () => {
  withTempDir('yoki-usage-omp-none-', (dir) => {
    const filePath = path.join(dir, 'session.jsonl');
    writeJsonl(filePath, [
      { type: 'title', message: { text: 'a session' } },
      { type: 'message', message: { role: 'user', content: 'hi' } },
    ]);

    assert.equal(readUsage(filePath, 'omp'), null);
  });
});

// ---------------------------------------------------------------------------
// readUsage: shared edge cases
// ---------------------------------------------------------------------------

test('readUsage: missing file is null for every harness', () => {
  const missing = '/no/such/file.jsonl';
  assert.equal(readUsage(missing, 'claude'), null);
  assert.equal(readUsage(missing, 'codex'), null);
  assert.equal(readUsage(missing, 'omp'), null);
});

test('readUsage: unknown harness is null', () => {
  withTempDir('yoki-usage-unknown-', (dir) => {
    const filePath = path.join(dir, 'session.jsonl');
    writeJsonl(filePath, [{ message: { usage: { input_tokens: 1 } } }]);

    assert.equal(readUsage(filePath, 'unknown-harness'), null);
  });
});

test('readUsage: empty/non-string path is null', () => {
  assert.equal(readUsage('', 'claude'), null);
  assert.equal(readUsage(undefined, 'codex'), null);
});
