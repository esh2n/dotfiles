'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../pre-compact.js');
const pendingContext = require('../../lib/pending-context.js');
const llmSummaryLib = require('../../lib/llm-summary.js');

/** Runs `fn` with the given env vars temporarily set, restoring (or
 * deleting, if unset before) each one afterward. */
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/** Replaces lib/llm-summary.js's generateSessionSummary for the duration of
 * `fn`, restoring the original afterward. pre-compact.js calls it through
 * the required module object (never destructures it) specifically so this
 * kind of stubbing works. */
function withStubbedSummary(returnValue, fn) {
  const original = llmSummaryLib.generateSessionSummary;
  let calls = 0;
  llmSummaryLib.generateSessionSummary = () => {
    calls += 1;
    return returnValue;
  };
  try {
    return { result: fn(), calls: () => calls };
  } finally {
    llmSummaryLib.generateSessionSummary = original;
  }
}

function existingTranscript() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pre-compact-')), 'transcript.jsonl');
  fs.writeFileSync(file, '{}\n', 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// omp
// ---------------------------------------------------------------------------

test('omp: prints {summary} JSON on stdout when a summary is generated', () => {
  const transcriptPath = existingTranscript();

  const { result, calls } = withEnv({ YOKI_HARNESS: 'omp' }, () =>
    withStubbedSummary('the compaction summary', () =>
      hook.run(JSON.stringify({ transcript_path: transcriptPath, session_id: 's1' }))
    )
  );

  assert.equal(calls(), 1);
  assert.deepEqual(result, { stdout: JSON.stringify({ summary: 'the compaction summary' }), exitCode: 0 });
});

test('omp: empty stdout when no summary is available', () => {
  const transcriptPath = existingTranscript();

  const { result } = withEnv({ YOKI_HARNESS: 'omp' }, () =>
    withStubbedSummary(null, () => hook.run(JSON.stringify({ transcript_path: transcriptPath })))
  );

  assert.deepEqual(result, { stdout: '', exitCode: 0 });
});

test('omp: never touches the pending-context queue', () => {
  const transcriptPath = existingTranscript();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-'));

  withEnv({ YOKI_HARNESS: 'omp', XDG_STATE_HOME: state }, () =>
    withStubbedSummary('summary text', () =>
      hook.run(JSON.stringify({ transcript_path: transcriptPath, session_id: 's1' }))
    )
  );

  assert.deepEqual(pendingContext.drain({ harness: 'omp', sessionId: 's1' }, { XDG_STATE_HOME: state }), []);
});

// ---------------------------------------------------------------------------
// codex
// ---------------------------------------------------------------------------

test('codex: enqueues the summary into pending-context with a ~2h ttl instead of printing it', () => {
  const transcriptPath = existingTranscript();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-'));

  const before = Date.now() / 1000;
  const { result, calls } = withEnv({ YOKI_HARNESS: 'codex', XDG_STATE_HOME: state }, () =>
    withStubbedSummary('the codex compaction summary', () =>
      hook.run(JSON.stringify({ transcript_path: transcriptPath, session_id: 's1' }))
    )
  );

  assert.equal(calls(), 1);
  assert.deepEqual(result, { stdout: '', exitCode: 0 });

  const file = pendingContext.queuePath({ harness: 'codex', sessionId: 's1' }, { XDG_STATE_HOME: state });
  const record = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(record.source, 'compaction');
  assert.equal(record.text, 'the codex compaction summary');
  assert.ok(record.expires_at > before + 7000 && record.expires_at < before + 7300, record.expires_at);

  assert.deepEqual(
    pendingContext.drain({ harness: 'codex', sessionId: 's1' }, { XDG_STATE_HOME: state }),
    ['the codex compaction summary']
  );
});

test('codex: falls back to YOKI_SESSION_ID when the payload carries no session_id', () => {
  const transcriptPath = existingTranscript();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-'));

  withEnv({ YOKI_HARNESS: 'codex', XDG_STATE_HOME: state, YOKI_SESSION_ID: 'env-session' }, () =>
    withStubbedSummary('summary via env session', () => hook.run(JSON.stringify({ transcript_path: transcriptPath })))
  );

  assert.deepEqual(
    pendingContext.drain({ harness: 'codex', sessionId: 'env-session' }, { XDG_STATE_HOME: state }),
    ['summary via env session']
  );
});

test('codex: nothing is enqueued when the transcript file does not exist', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-'));

  const { result, calls } = withEnv({ YOKI_HARNESS: 'codex', XDG_STATE_HOME: state }, () =>
    withStubbedSummary('should never be used', () =>
      hook.run(JSON.stringify({ transcript_path: '/no/such/transcript.jsonl', session_id: 's1' }))
    )
  );

  assert.equal(calls(), 0, 'generateSessionSummary must not run without a transcript to summarize');
  assert.deepEqual(result, { stdout: '', exitCode: 0 });
  assert.deepEqual(pendingContext.drain({ harness: 'codex', sessionId: 's1' }, { XDG_STATE_HOME: state }), []);
});

test('codex: nothing is enqueued when generateSessionSummary comes back empty', () => {
  const transcriptPath = existingTranscript();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-'));

  withEnv({ YOKI_HARNESS: 'codex', XDG_STATE_HOME: state }, () =>
    withStubbedSummary(null, () => hook.run(JSON.stringify({ transcript_path: transcriptPath, session_id: 's1' })))
  );

  assert.deepEqual(pendingContext.drain({ harness: 'codex', sessionId: 's1' }, { XDG_STATE_HOME: state }), []);
});

// ---------------------------------------------------------------------------
// claude (default / unchanged path)
// ---------------------------------------------------------------------------

test('claude: with no active session file, logs and returns quietly without touching pending-context', () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-claude-dir-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-'));
  const transcriptPath = existingTranscript();

  const { result, calls } = withEnv(
    { YOKI_AGENT_DATA_HOME: claudeDir, XDG_STATE_HOME: state },
    () =>
      withStubbedSummary('should never be used', () =>
        hook.run(JSON.stringify({ transcript_path: transcriptPath, session_id: 's1' }))
      )
  );

  assert.equal(calls(), 0, 'no active session file means generateSessionSummary is never reached');
  assert.deepEqual(result, { stdout: '', exitCode: 0 });
  assert.deepEqual(pendingContext.drain({ harness: 'claude', sessionId: 's1' }, { XDG_STATE_HOME: state }), []);
});

test('claude is the default harness when YOKI_HARNESS is unset', () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-claude-dir-'));
  withEnv({ YOKI_AGENT_DATA_HOME: claudeDir }, () => {
    delete process.env.YOKI_HARNESS;
    const result = hook.run('not json');
    assert.deepEqual(result, { stdout: '', exitCode: 0 });
  });
});

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

test('malformed stdin is handled without throwing (omp harness, no transcript to summarize)', () => {
  const { result } = withEnv({ YOKI_HARNESS: 'omp' }, () => withStubbedSummary('unused', () => hook.run('not json')));
  assert.deepEqual(result, { stdout: '', exitCode: 0 });
});

test('resolveSessionId prefers the payload over env fallbacks', () => {
  withEnv({ YOKI_SESSION_ID: 'env-id' }, () => {
    assert.equal(hook.resolveSessionId({ session_id: 'payload-id' }), 'payload-id');
    assert.equal(hook.resolveSessionId({}), 'env-id');
  });
});
