'use strict';

/**
 * The flag parser both CLIs in lib/graph share.
 *
 * It used to exist twice — cli.js and agent-cli.js each carried a copy —
 * and the copies had already diverged on the one thing that matters:
 * cli.js knew `--watch` took no value and agent-cli.js did not, so the same
 * argv parsed differently depending on which CLI read it. These tests pin
 * the shared behaviour and, at the bottom, that neither CLI has grown a
 * private copy again.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const args = require('../args');
const cli = require('../cli');
const agentCli = require('../agent-cli');

test('--key value, positionals, and a value-less flag at the end', () => {
  assert.deepEqual(args.parseArgs(['run', 'review', '--model', 'opus', '--cwd', '/tmp']), {
    _: ['run', 'review'], model: 'opus', cwd: '/tmp',
  });
  // A flag with no value, because the next token is a flag or there is none.
  assert.deepEqual(args.parseArgs(['--a', '--b', 'v']), { _: [], a: true, b: 'v' });
  assert.deepEqual(args.parseArgs(['--a']), { _: [], a: true });
  assert.deepEqual(args.parseArgs([]), { _: [] });
});

test('a declared boolean flag never swallows the token after it', () => {
  // Without the declaration `--json` would eat `run`, and the command would
  // vanish into a flag value.
  assert.deepEqual(args.parseArgs(['--json', 'run'], ['json']), { _: ['run'], json: true });
  assert.deepEqual(args.parseArgs(['--json', 'run']), { _: [], json: 'run' });
  // A Set is accepted as well as an array.
  assert.deepEqual(args.parseArgs(['--watch', 'x'], new Set(['watch'])), { _: ['x'], watch: true });
});

test('numberFlag: a number, or undefined so the caller uses its documented default', () => {
  assert.equal(args.numberFlag('1500'), 1500);
  assert.equal(args.numberFlag('0'), 0);
  assert.equal(args.numberFlag(undefined), undefined);
  assert.equal(args.numberFlag(true), undefined);   // `--timeout` with no value
  assert.equal(args.numberFlag('15m'), undefined);  // unusable -> default
});

test('both CLIs parse through this module, with their own boolean sets', () => {
  // yoki-graph knows --watch; yoki-agent knows --allow-mock. Each CLI's
  // own set is the only thing that legitimately differs.
  assert.deepEqual(cli.parseArgs(['status', 'r1', '--watch']), { _: ['status', 'r1'], watch: true });
  assert.deepEqual(agentCli.parseArgs(['--allow-mock', '--backend', 'codex']), {
    _: [], 'allow-mock': true, backend: 'codex',
  });
  assert.equal(cli.numberFlag, args.numberFlag, 'cli.js re-implemented numberFlag');

  // And neither file has grown its own copy back.
  for (const name of ['cli.js', 'agent-cli.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    assert.doesNotMatch(text, /function parseArgs\(/, `${name} defines its own parseArgs again`);
    assert.doesNotMatch(text, /function numberFlag\(/, `${name} defines its own numberFlag again`);
  }
});
