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

// ---------------------------------------------------------------------------
// unattended posture: a loop run IS an unattended agent run, so every child
// must carry YOKI_UNATTENDED=1 — that flag is what arms
// hooks/unattended-guard.sh, which `exit 0`s (does nothing) without it.
// ---------------------------------------------------------------------------

function captureChildOptions(runOptions, env, dotfilesRoot) {
  let childOptions = null;
  runner.run(
    { cwd: '.', prompt: 'hi', dotfilesRoot, env, ...runOptions },
    {
      spawn: (cmd, args, options) => {
        childOptions = options;
        return { status: 0, signal: null, stdout: '{}', stderr: '' };
      },
    }
  );
  return childOptions;
}

test('every spawned child gets YOKI_UNATTENDED=1 in its environment', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const options = captureChildOptions({ name: 'demo', harness: 'claude' }, env, dotfilesRoot);
      assert.equal(options.env.YOKI_UNATTENDED, '1');
    });
  });
});

test('the unattended flag is set on every harness, not just codex', () => {
  for (const harness of ['claude', 'codex', 'omp']) {
    withTempHome((env) => {
      withTempDotfilesRoot((dotfilesRoot) => {
        const options = captureChildOptions({ name: `demo-${harness}`, harness }, env, dotfilesRoot);
        assert.equal(options.env.YOKI_UNATTENDED, '1', `${harness} child must be unattended`);
      });
    });
  }
});

test('the rest of the runner environment is inherited, not replaced, by the unattended flag', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const options = captureChildOptions(
        { name: 'demo', harness: 'claude' },
        { ...env, SOME_EXISTING_VAR: 'kept' },
        dotfilesRoot
      );
      assert.equal(options.env.SOME_EXISTING_VAR, 'kept');
      assert.equal(options.env.YOKI_UNATTENDED, '1');
    });
  });
});

test('childEnv never mutates the runner\'s own environment object', () => {
  const original = { PATH: '/bin' };
  const child = runner.childEnv(original);
  assert.equal(child.YOKI_UNATTENDED, '1');
  assert.equal(original.YOKI_UNATTENDED, undefined);
});

test('an explicit YOKI_UNATTENDED=0 in the caller\'s env cannot disarm the guard', () => {
  // A loop run is unattended by definition; the flag is not negotiable per run.
  assert.equal(runner.childEnv({ YOKI_UNATTENDED: '0' }).YOKI_UNATTENDED, '1');
});

// ---------------------------------------------------------------------------
// the prompt never reaches runs.jsonl in cleartext
// ---------------------------------------------------------------------------

const SECRET_PROMPT = 'audit acme-corp/billing: ssh key rotation for alice@example.com';

function readRawLog(env) {
  return fs.readFileSync(state.runsPath('demo', env), 'utf8');
}

test('claude: the recorded row carries a prompt fingerprint, not the prompt', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const { row } = runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: SECRET_PROMPT, dotfilesRoot, env },
        { spawn: okSpawn(JSON.stringify({ session_id: 'sess-1' })) }
      );
      const placeholder = state.promptPlaceholder(SECRET_PROMPT);
      assert.deepEqual(row.cmd, ['claude', '-p', placeholder, '--output-format', 'json']);
      assert.equal(row.prompt, placeholder);
      // The file on disk, not just the in-memory row.
      const raw = readRawLog(env);
      assert.ok(!raw.includes('acme-corp'), 'runs.jsonl must not hold the prompt text');
      assert.ok(!raw.includes('alice@example.com'));
      assert.ok(raw.includes(placeholder));
    });
  });
});

test('omp: the trailing prompt positional is fingerprinted too, flags stay verbatim', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const { row } = runner.run(
        { name: 'demo', harness: 'omp', cwd: '.', prompt: SECRET_PROMPT, sandbox: 'read-only', dotfilesRoot, env },
        { spawn: okSpawn('{}') }
      );
      assert.equal(row.cmd[row.cmd.length - 1], state.promptPlaceholder(SECRET_PROMPT));
      assert.ok(row.cmd.includes('--no-extensions'), 'the guard flags must survive redaction');
      assert.ok(row.cmd.includes('--tools'));
      assert.ok(!readRawLog(env).includes('acme-corp'));
    });
  });
});

test('codex: the stdin prompt is fingerprinted in the row prompt field', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      let sawStdin = null;
      const { row } = runner.run(
        { name: 'demo', harness: 'codex', cwd: '.', prompt: SECRET_PROMPT, dotfilesRoot, env },
        {
          spawn: (cmd, args, opts) => {
            sawStdin = opts.input;
            return { status: 0, signal: null, stdout: '{}', stderr: '' };
          },
        }
      );
      // The harness still receives the real prompt — only the log is redacted.
      assert.equal(sawStdin, SECRET_PROMPT);
      assert.equal(row.prompt, state.promptPlaceholder(SECRET_PROMPT));
      assert.equal(row.cmd[row.cmd.length - 1], '-'); // argv had nothing to redact
      assert.ok(!readRawLog(env).includes('acme-corp'));
    });
  });
});

test('the same prompt fingerprints identically across runs; a changed one does not', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const first = runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: SECRET_PROMPT, dotfilesRoot, env },
        { spawn: okSpawn('{}') }
      ).row;
      const second = runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: SECRET_PROMPT, dotfilesRoot, env },
        { spawn: okSpawn('{}') }
      ).row;
      const changed = runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: `${SECRET_PROMPT}!`, dotfilesRoot, env },
        { spawn: okSpawn('{}') }
      ).row;
      assert.equal(first.prompt, second.prompt);
      assert.notEqual(first.prompt, changed.prompt);
    });
  });
});

test('--dry-run still prints the real prompt: that goes to a terminal, not a log', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      let printed = '';
      runner.run(
        { name: 'demo', harness: 'claude', cwd: '.', prompt: SECRET_PROMPT, dryRun: true, dotfilesRoot, env },
        { spawn: () => { throw new Error('must not spawn'); }, writeOut: (t) => { printed += t; } }
      );
      assert.ok(printed.includes('acme-corp'));
      assert.deepEqual(state.readRuns('demo', env), []);
    });
  });
});
