'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const { stateHome } = require('../state-home');
const pendingContext = require('../pending-context');
const loopState = require('../loop/state');
const loopInbox = require('../loop/inbox');
const journal = require('../graph/journal');

test('stateHome: XDG_STATE_HOME wins, blank is ignored, HOME is the fallback', () => {
  assert.equal(stateHome({ XDG_STATE_HOME: '/custom/state', HOME: '/home/u' }), '/custom/state');
  assert.equal(stateHome({ XDG_STATE_HOME: '   ', HOME: '/home/u' }), path.join('/home/u', '.local', 'state'));
  assert.equal(stateHome({ HOME: '/home/u' }), path.join('/home/u', '.local', 'state'));
});

test('stateHome: an env with neither variable falls back to the real home, never to ""', () => {
  assert.equal(stateHome({}), path.join(os.homedir(), '.local', 'state'));
});

// The point of the shared helper: four modules used to carry near-identical
// copies of this two-liner and one of them (graph/journal.js) read a different
// variable with no XDG fallback, so relocating state moved four of the five
// state files and silently left graph run journals behind.
test('every yoki state path relocates together under one XDG_STATE_HOME', () => {
  const env = { XDG_STATE_HOME: '/custom/state', HOME: '/home/u' };
  const root = '/custom/state';

  assert.equal(pendingContext.queueDir(env), path.join(root, 'yoki', 'pending-context'));
  assert.equal(loopState.runsPath('demo', env), path.join(root, 'yoki', 'loop', 'demo', 'runs.jsonl'));
  assert.equal(loopInbox.cursorPath(env), path.join(root, 'yoki', 'loop', 'inbox.cursor.json'));
  assert.equal(loopInbox.inboxPath(env), path.join(root, 'yoki', 'artifact', 'inbox.jsonl'));
  assert.equal(journal.runDir('r1', env), path.join(root, 'yoki', 'graph', 'r1'));
});
