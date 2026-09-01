'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractSessionId } = require('../session-id');

test('claude: extracts top-level session_id from the single JSON result object', () => {
  const stdout = JSON.stringify({ type: 'result', session_id: 'abc-123', result: 'done' });
  assert.equal(extractSessionId('claude', stdout), 'abc-123');
});

test('claude: null when session_id is absent', () => {
  assert.equal(extractSessionId('claude', JSON.stringify({ result: 'done' })), null);
});

test('claude: null on unparsable stdout', () => {
  assert.equal(extractSessionId('claude', 'not json at all'), null);
});

test('codex: finds a top-level thread_id in an NDJSON stream', () => {
  const stdout = [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-42' }),
    JSON.stringify({ type: 'item.completed', item: {} }),
  ].join('\n');
  assert.equal(extractSessionId('codex', stdout), 'thread-42');
});

test('codex: finds a nested msg.thread_id', () => {
  const stdout = JSON.stringify({ type: 'event_msg', msg: { type: 'session_configured', thread_id: 'thread-7' } });
  assert.equal(extractSessionId('codex', stdout), 'thread-7');
});

test('codex: null when no line carries a thread id', () => {
  const stdout = JSON.stringify({ type: 'item.completed' });
  assert.equal(extractSessionId('codex', stdout), null);
});

test('omp: reads the id off the {type:"session"} header line', () => {
  const stdout = [
    JSON.stringify({ type: 'session', sessionId: 'omp-sess-1' }),
    JSON.stringify({ type: 'message', message: { role: 'assistant' } }),
  ].join('\n');
  assert.equal(extractSessionId('omp', stdout), 'omp-sess-1');
});

test('omp: accepts session_id or id as fallback key names', () => {
  assert.equal(extractSessionId('omp', JSON.stringify({ type: 'session', session_id: 'x1' })), 'x1');
  assert.equal(extractSessionId('omp', JSON.stringify({ type: 'session', id: 'x2' })), 'x2');
});

test('omp: null when there is no session-typed line', () => {
  const stdout = JSON.stringify({ type: 'message', message: {} });
  assert.equal(extractSessionId('omp', stdout), null);
});

test('extractSessionId: unknown harness always returns null', () => {
  assert.equal(extractSessionId('gemini', JSON.stringify({ session_id: 'x' })), null);
});

test('handles a truncated/partial trailing line without throwing', () => {
  const stdout = `${JSON.stringify({ type: 'thread.started', thread_id: 't-1' })}\n{"incomple`;
  assert.equal(extractSessionId('codex', stdout), 't-1');
});
