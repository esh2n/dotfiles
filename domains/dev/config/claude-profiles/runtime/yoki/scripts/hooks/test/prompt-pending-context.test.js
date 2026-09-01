'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../prompt-pending-context.js');
const pendingContext = require('../../lib/pending-context.js');

function freshState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-hook-'));
}

/** Runs `fn` with the given env vars temporarily set, restoring (or
 * deleting, if unset before) each one afterward — both the hook and
 * lib/pending-context.js resolve their state at call time from process.env. */
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

function runWith(stateHome, payload, extraEnv = {}) {
  return withEnv({ XDG_STATE_HOME: stateHome, ...extraEnv }, () => hook.run(JSON.stringify(payload)));
}

function contextOf(result) {
  assert.equal(typeof result, 'object');
  const parsed = JSON.parse(result.stdout);
  return parsed.hookSpecificOutput;
}

test('an empty queue says nothing', () => {
  const state = freshState();
  const result = runWith(state, { hook_event_name: 'UserPromptSubmit', prompt: 'hi', session_id: 's1' });
  assert.deepEqual(result, { stdout: '', exitCode: 0 });
});

test('a queued item is drained and surfaced as additionalContext', () => {
  const state = freshState();
  const env = { XDG_STATE_HOME: state };
  withEnv(env, () => {
    pendingContext.enqueue({ harness: 'claude', sessionId: 's1' }, { source: 'compaction', text: 'the summary text' });
  });

  const out = contextOf(runWith(state, { hook_event_name: 'UserPromptSubmit', session_id: 's1' }));
  assert.equal(out.hookEventName, 'UserPromptSubmit');
  assert.equal(out.additionalContext, 'the summary text');
});

test('several queued items are joined by a blank line, in enqueue order', () => {
  const state = freshState();
  withEnv({ XDG_STATE_HOME: state }, () => {
    pendingContext.enqueue({ harness: 'claude', sessionId: 's1' }, { text: 'first item' });
    pendingContext.enqueue({ harness: 'claude', sessionId: 's1' }, { text: 'second item' });
  });

  const out = contextOf(runWith(state, { hook_event_name: 'UserPromptSubmit', session_id: 's1' }));
  assert.equal(out.additionalContext, 'first item\n\nsecond item');
});

test('the queue is cleared once drained — a second prompt sees nothing new', () => {
  const state = freshState();
  withEnv({ XDG_STATE_HOME: state }, () => {
    pendingContext.enqueue({ harness: 'claude', sessionId: 's1' }, { text: 'only once' });
  });

  const first = runWith(state, { hook_event_name: 'UserPromptSubmit', session_id: 's1' });
  assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /only once/);

  const second = runWith(state, { hook_event_name: 'UserPromptSubmit', session_id: 's1' });
  assert.deepEqual(second, { stdout: '', exitCode: 0 });
});

test('harness and session id select which queue is drained', () => {
  const state = freshState();
  withEnv({ XDG_STATE_HOME: state }, () => {
    pendingContext.enqueue({ harness: 'codex', sessionId: 's1' }, { text: 'codex item' });
    pendingContext.enqueue({ harness: 'claude', sessionId: 's1' }, { text: 'claude item' });
  });

  const claudeOut = contextOf(runWith(state, { hook_event_name: 'UserPromptSubmit', session_id: 's1' }));
  assert.equal(claudeOut.additionalContext, 'claude item');

  const codexOut = contextOf(runWith(state, { hook_event_name: 'UserPromptSubmit', session_id: 's1' }, { YOKI_HARNESS: 'codex' }));
  assert.equal(codexOut.additionalContext, 'codex item');
});

test('falls back to YOKI_SESSION_ID when the payload carries no session_id', () => {
  const state = freshState();
  withEnv({ XDG_STATE_HOME: state }, () => {
    pendingContext.enqueue({ harness: 'claude', sessionId: 'env-session' }, { text: 'via env fallback' });
  });

  const out = contextOf(
    runWith(state, { hook_event_name: 'UserPromptSubmit' }, { YOKI_SESSION_ID: 'env-session' })
  );
  assert.equal(out.additionalContext, 'via env fallback');
});

test('an unrelated event is passed over in silence and does not drain the queue', () => {
  const state = freshState();
  withEnv({ XDG_STATE_HOME: state }, () => {
    pendingContext.enqueue({ harness: 'claude', sessionId: 's1' }, { text: 'stays queued' });
  });

  assert.deepEqual(
    runWith(state, { hook_event_name: 'SessionStart', session_id: 's1' }),
    { stdout: '', exitCode: 0 }
  );

  const out = contextOf(runWith(state, { hook_event_name: 'UserPromptSubmit', session_id: 's1' }));
  assert.equal(out.additionalContext, 'stays queued');
});

test('malformed stdin is passed over in silence', () => {
  assert.deepEqual(hook.run('not json'), { stdout: '', exitCode: 0 });
});

test('resolveHarness defaults to claude', () => {
  withEnv({ YOKI_HARNESS: '' }, () => {
    delete process.env.YOKI_HARNESS;
    assert.equal(hook.resolveHarness(), 'claude');
  });
});

test('resolveSessionId prefers the payload over env fallbacks', () => {
  withEnv({ YOKI_SESSION_ID: 'env-id' }, () => {
    assert.equal(hook.resolveSessionId({ session_id: 'payload-id' }), 'payload-id');
    assert.equal(hook.resolveSessionId({}), 'env-id');
  });
});
