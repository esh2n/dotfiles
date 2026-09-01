'use strict';

/**
 * `runner.run` end to end, except the actual harness invocation: `spawn` is
 * always a fake injected via `deps.spawn` (task T19: "no real agent
 * invocation in tests").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('../runner');
const state = require('../state');

function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-runner-'));
  try {
    return fn({ HOME: home });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function withTempDotfilesRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-runner-root-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function okSpawn(stdout) {
  return () => ({ status: 0, signal: null, stdout, stderr: '' });
}

test('dry-run: writes the argv line, spawns nothing, appends no run row', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      let spawned = false;
      let printed = '';
      const result = runner.run(
        { name: 'demo', harness: 'codex', cwd: '.', prompt: 'hi', dryRun: true, dotfilesRoot, env },
        { spawn: () => { spawned = true; }, writeOut: (t) => { printed += t; } }
      );
      assert.equal(spawned, false);
      assert.equal(result.dryRun, true);
      assert.match(printed, /^codex exec --skip-git-repo-check -C \. -s workspace-write --json -\n$/);
      assert.deepEqual(state.readRuns('demo', env), []);
    });
  });
});

test('real run: appends a runs.jsonl row with the parsed sessionId', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const result = runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: 'hi', dotfilesRoot, env },
        { spawn: okSpawn(JSON.stringify({ session_id: 'sess-1' })) }
      );
      assert.equal(result.dryRun, false);
      assert.equal(result.row.sessionId, 'sess-1');
      assert.equal(result.row.exit, 0);
      assert.equal(result.row.harness, 'claude');
      assert.deepEqual(state.readRuns('demo', env), [result.row]);
    });
  });
});

test('--resume: passes the previous run\'s sessionId into the built argv', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: 'first', dotfilesRoot, env },
        { spawn: okSpawn(JSON.stringify({ session_id: 'sess-1' })) }
      );

      let seenArgs = null;
      runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: 'second', resume: true, dotfilesRoot, env },
        {
          spawn: (cmd, args) => {
            seenArgs = args;
            return { status: 0, signal: null, stdout: JSON.stringify({ session_id: 'sess-2' }), stderr: '' };
          },
        }
      );
      assert.ok(seenArgs.includes('--resume'));
      assert.equal(seenArgs[seenArgs.indexOf('--resume') + 1], 'sess-1');
    });
  });
});

test('--resume with no prior run: omits the resume flag entirely', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      let seenArgs = null;
      runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: 'first', resume: true, dotfilesRoot, env },
        {
          spawn: (cmd, args) => {
            seenArgs = args;
            return { status: 0, signal: null, stdout: '{}', stderr: '' };
          },
        }
      );
      assert.ok(!seenArgs.includes('--resume'));
    });
  });
});

test('--model resolves through core/harness-models.json', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const dir = path.join(dotfilesRoot, 'domains', 'dev', 'config', 'claude-profiles', 'core');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'harness-models.json'), JSON.stringify({ codex: { sonnet: 'gpt-5.1-codex' } }));

      let seenArgs = null;
      runner.run(
        { name: 'demo', harness: 'codex', cwd: '.', prompt: 'hi', model: 'sonnet', dotfilesRoot, env },
        {
          spawn: (cmd, args) => {
            seenArgs = args;
            return { status: 0, signal: null, stdout: '{}', stderr: '' };
          },
        }
      );
      assert.ok(seenArgs.includes('-m'));
      assert.equal(seenArgs[seenArgs.indexOf('-m') + 1], 'gpt-5.1-codex');
    });
  });
});

test('daily cap: refuses the run once today\'s count reaches the cap, and appends nothing', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const opts = { name: 'demo', harness: 'claude', cwd: '.', prompt: 'hi', maxRuns: 1, dotfilesRoot, env };
      runner.run(opts, { spawn: okSpawn('{}') });

      assert.throws(() => runner.run(opts, { spawn: okSpawn('{}') }), runner.DailyCapError);
      assert.equal(state.readRuns('demo', env).length, 1);
    });
  });
});

test('daily cap: --dry-run is never blocked by the cap', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const opts = { name: 'demo', harness: 'claude', cwd: '.', prompt: 'hi', maxRuns: 1, dotfilesRoot, env };
      runner.run(opts, { spawn: okSpawn('{}') });

      assert.doesNotThrow(() =>
        runner.run({ ...opts, dryRun: true }, { spawn: () => { throw new Error('must not spawn'); }, writeOut: () => {} })
      );
    });
  });
});

test('a nonzero exit is recorded, not thrown', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const result = runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: 'hi', dotfilesRoot, env },
        { spawn: () => ({ status: 1, signal: null, stdout: '{}', stderr: 'boom' }) }
      );
      assert.equal(result.row.exit, 1);
      assert.equal(result.stderr, 'boom');
    });
  });
});
