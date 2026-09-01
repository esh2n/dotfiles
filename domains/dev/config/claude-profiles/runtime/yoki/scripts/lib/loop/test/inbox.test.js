'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const inbox = require('../inbox');

function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-inbox-'));
  try {
    return fn({ HOME: home });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function writeInbox(env, entries) {
  const file = inbox.inboxPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

function entry(id, body, channel = 'c1', author = 'bob') {
  return { channel, comment: { id, author, body } };
}

test('consumeArtifactInboxPrompt: null when there is no inbox file at all', () => {
  withTempHome((env) => {
    assert.equal(inbox.consumeArtifactInboxPrompt(env), null);
  });
});

test('consumeArtifactInboxPrompt: renders every unread comment into one prompt', () => {
  withTempHome((env) => {
    writeInbox(env, [entry('a', 'fix the header'), entry('b', 'typo on line 2', 'c1', 'alice')]);
    const prompt = inbox.consumeArtifactInboxPrompt(env);
    assert.match(prompt, /^Address these artifact comments:/);
    assert.match(prompt, /fix the header/);
    assert.match(prompt, /typo on line 2/);
  });
});

test('consumeArtifactInboxPrompt: marks lines consumed — a second call sees nothing new', () => {
  withTempHome((env) => {
    writeInbox(env, [entry('a', 'one')]);
    assert.notEqual(inbox.consumeArtifactInboxPrompt(env), null);
    assert.equal(inbox.consumeArtifactInboxPrompt(env), null);
  });
});

test('consumeArtifactInboxPrompt: a later call only picks up newly appended lines', () => {
  withTempHome((env) => {
    writeInbox(env, [entry('a', 'one')]);
    inbox.consumeArtifactInboxPrompt(env);

    const file = inbox.inboxPath(env);
    fs.appendFileSync(file, `${JSON.stringify(entry('b', 'two'))}\n`);

    const prompt = inbox.consumeArtifactInboxPrompt(env);
    assert.match(prompt, /two/);
    assert.doesNotMatch(prompt, /\bone\b/);
  });
});

test('consumeArtifactInboxPrompt: does not disturb yoki-artifact\'s own cursor file', () => {
  withTempHome((env) => {
    writeInbox(env, [entry('a', 'one')]);
    const artifactCursor = path.join(env.HOME, '.local', 'state', 'yoki', 'artifact', 'inbox.cursor.json');
    fs.mkdirSync(path.dirname(artifactCursor), { recursive: true });
    fs.writeFileSync(artifactCursor, JSON.stringify({ delivered: 0 }));

    inbox.consumeArtifactInboxPrompt(env);

    assert.deepEqual(JSON.parse(fs.readFileSync(artifactCursor, 'utf8')), { delivered: 0 });
    assert.notEqual(inbox.cursorPath(env), artifactCursor);
  });
});

test('readUnread: does not mutate the cursor (dry inspection)', () => {
  withTempHome((env) => {
    writeInbox(env, [entry('a', 'one')]);
    const { entries } = inbox.readUnread(env);
    assert.equal(entries.length, 1);
    assert.equal(inbox.readUnread(env).entries.length, 1); // still unread
  });
});

test('a malformed trailing line does not lose the entries that parsed fine', () => {
  withTempHome((env) => {
    const file = inbox.inboxPath(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(entry('a', 'ok'))}\n{"trun`);
    const prompt = inbox.consumeArtifactInboxPrompt(env);
    assert.match(prompt, /ok/);
  });
});
