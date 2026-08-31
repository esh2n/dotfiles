'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../artifact-comments.js');

const INBOX_REL = path.join('yoki', 'artifact', 'inbox.jsonl');
const CURSOR_REL = path.join('yoki', 'artifact', 'inbox.cursor.json');

function freshState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-artifact-inbox-'));
}

function entry(id, { channel = 'design-doc', author = 'esh2n@example.test', body = 'looks good' } = {}) {
  return {
    recorded_at: '2026-08-31T00:00:00.000Z',
    channel,
    url: `https://artifacts.example.test/a/${channel}`,
    comment: { id, author, body, to_agent: 1, agent_seen_at: null, resolved_at: null, parent_id: null },
  };
}

function writeInbox(stateHome, entries) {
  const file = path.join(stateHome, INBOX_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf8');
  return file;
}

function appendInbox(stateHome, entries) {
  fs.appendFileSync(path.join(stateHome, INBOX_REL), entries.map(e => `${JSON.stringify(e)}\n`).join(''), 'utf8');
}

function readCursorFile(stateHome) {
  return JSON.parse(fs.readFileSync(path.join(stateHome, CURSOR_REL), 'utf8'));
}

/** Runs the hook with XDG_STATE_HOME pointed at a scratch directory, then puts
 * the real environment back — the hook resolves the inbox at call time. */
function runWith(stateHome, payload) {
  const saved = Object.prototype.hasOwnProperty.call(process.env, 'XDG_STATE_HOME')
    ? process.env.XDG_STATE_HOME
    : undefined;
  process.env.XDG_STATE_HOME = stateHome;
  try {
    return hook.run(JSON.stringify(payload));
  } finally {
    if (saved === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = saved;
  }
}

function contextOf(result) {
  assert.equal(typeof result, 'object');
  const parsed = JSON.parse(result.stdout);
  return parsed.hookSpecificOutput;
}

test('inboxPaths honours XDG_STATE_HOME', () => {
  const paths = hook.inboxPaths({ XDG_STATE_HOME: '/tmp/state', HOME: '/home/nobody' });
  assert.equal(paths.inbox, path.join('/tmp/state', INBOX_REL));
  assert.equal(paths.cursor, path.join('/tmp/state', CURSOR_REL));
});

test('inboxPaths falls back to ~/.local/state', () => {
  const paths = hook.inboxPaths({ HOME: '/home/nobody' });
  assert.equal(paths.inbox, path.join('/home/nobody', '.local', 'state', INBOX_REL));
});

test('SessionStart with no inbox at all says nothing', () => {
  const state = freshState();
  const result = runWith(state, { hook_event_name: 'SessionStart', session_id: 's1' });
  assert.deepEqual(result, { stdout: '', exitCode: 0 });
});

test('SessionStart reports unread comments as hookSpecificOutput.additionalContext', () => {
  const state = freshState();
  writeInbox(state, [entry('c1', { author: 'alice@example.test', body: 'please add the rollback plan' })]);

  const result = runWith(state, { hook_event_name: 'SessionStart' });
  const out = contextOf(result);
  assert.equal(out.hookEventName, 'SessionStart');
  assert.match(out.additionalContext, /^yoki-artifact: 1 unread comment on design-doc$/m);
  assert.match(out.additionalContext, /alice@example\.test: please add the rollback plan \(id c1\)/);
  assert.match(out.additionalContext, /yoki-artifact reply <channel> <id>/);
  assert.match(out.additionalContext, /yoki-artifact seen <channel> <id>/);
});

test('UserPromptSubmit uses its own hookEventName', () => {
  const state = freshState();
  writeInbox(state, [entry('c1')]);
  const out = contextOf(runWith(state, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }));
  assert.equal(out.hookEventName, 'UserPromptSubmit');
});

test('an unrelated event is passed over in silence', () => {
  const state = freshState();
  writeInbox(state, [entry('c1')]);
  assert.deepEqual(runWith(state, { hook_event_name: 'PreToolUse', tool_name: 'Bash' }), { stdout: '', exitCode: 0 });
  assert.ok(!fs.existsSync(path.join(state, CURSOR_REL)), 'the cursor must not move for an event we do not handle');
});

test('malformed stdin is passed over in silence', () => {
  assert.deepEqual(hook.run('not json'), { stdout: '', exitCode: 0 });
});

test('the cursor advances so the same comment is not announced twice', () => {
  const state = freshState();
  writeInbox(state, [entry('c1'), entry('c2')]);

  const first = contextOf(runWith(state, { hook_event_name: 'SessionStart' }));
  assert.match(first.additionalContext, /2 unread comments/);
  assert.equal(readCursorFile(state).delivered, 2);

  assert.deepEqual(runWith(state, { hook_event_name: 'UserPromptSubmit' }), { stdout: '', exitCode: 0 });

  appendInbox(state, [entry('c3', { channel: 'retry-policy', body: 'one more' })]);
  const second = contextOf(runWith(state, { hook_event_name: 'UserPromptSubmit' }));
  assert.match(second.additionalContext, /1 unread comment on retry-policy/);
  assert.match(second.additionalContext, /\(id c3\)/);
  assert.ok(!second.additionalContext.includes('id c1'));
  assert.equal(readCursorFile(state).delivered, 3);
});

test('at most 5 comments are quoted, but the count and the cursor cover them all', () => {
  const state = freshState();
  const many = [];
  for (let i = 1; i <= 8; i++) many.push(entry(`c${i}`, { body: `comment ${i}` }));
  writeInbox(state, many);

  const out = contextOf(runWith(state, { hook_event_name: 'SessionStart' }));
  const quoted = out.additionalContext.split('\n').filter(l => /\(id c\d+\)/.test(l));
  assert.equal(quoted.length, hook.MAX_SHOWN);
  assert.match(out.additionalContext, /8 unread comments/);
  // newest first
  assert.match(quoted[0], /\(id c8\)/);
  assert.match(quoted[4], /\(id c4\)/);
  assert.match(out.additionalContext, /… 3 older/);
  assert.equal(readCursorFile(state).delivered, 8);
});

test('several channels are all named in the header', () => {
  const state = freshState();
  writeInbox(state, [entry('c1', { channel: 'design-doc' }), entry('c2', { channel: 'retry-policy' })]);
  const out = contextOf(runWith(state, { hook_event_name: 'SessionStart' }));
  assert.match(out.additionalContext, /2 unread comments on design-doc, retry-policy/);
});

test('a long body is truncated', () => {
  const state = freshState();
  writeInbox(state, [entry('c1', { body: 'x'.repeat(500) })]);
  const out = contextOf(runWith(state, { hook_event_name: 'SessionStart' }));
  const line = out.additionalContext.split('\n').find(l => l.includes('(id c1)'));
  assert.ok(line.includes('…'));
  assert.ok(line.length < 300, line.length);
});

test('a truncated final line does not cost the entries that parsed', () => {
  const state = freshState();
  const file = writeInbox(state, [entry('c1')]);
  fs.appendFileSync(file, '{"channel":"design-doc","comm\n', 'utf8');
  const out = contextOf(runWith(state, { hook_event_name: 'SessionStart' }));
  assert.match(out.additionalContext, /1 unread comment/);
  assert.match(out.additionalContext, /\(id c1\)/);
});

test('a cursor pointing past the end of a truncated log resets instead of skipping everything', () => {
  const state = freshState();
  writeInbox(state, [entry('c1')]);
  const cursorFile = path.join(state, CURSOR_REL);
  fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
  fs.writeFileSync(cursorFile, JSON.stringify({ delivered: 99 }), 'utf8');

  const out = contextOf(runWith(state, { hook_event_name: 'SessionStart' }));
  assert.match(out.additionalContext, /1 unread comment/);
  assert.equal(readCursorFile(state).delivered, 1);
});

test('a corrupt cursor file is treated as "nothing delivered yet"', () => {
  const state = freshState();
  writeInbox(state, [entry('c1')]);
  const cursorFile = path.join(state, CURSOR_REL);
  fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
  fs.writeFileSync(cursorFile, 'not json', 'utf8');
  assert.equal(hook.readCursor(cursorFile, 1), 0);
  const out = contextOf(runWith(state, { hook_event_name: 'SessionStart' }));
  assert.match(out.additionalContext, /1 unread comment/);
});

test('formatContext returns nothing for an empty batch', () => {
  assert.equal(hook.formatContext([]), '');
});
