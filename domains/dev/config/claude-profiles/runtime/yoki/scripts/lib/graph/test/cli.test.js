'use strict';

/**
 * `yoki-graph list` and `yoki-graph status` — the two of the CLI's three
 * documented subcommands that had no test at all. `run` was covered by
 * scripts.test.js and the shell e2e; cmdList/cmdStatus and the runner
 * functions behind them (listWorkflows, readRunMeta) were reachable only by
 * a human typing them, so either could have been broken on arrival.
 *
 * YOKI_WORKFLOWS_DIR points listWorkflows at a fixture directory and
 * YOKI_STATE_HOME points the journal at a temp state root, so nothing here
 * depends on — or touches — what is installed on the machine running it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withEnv(overrides, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    process.env[key] = value;
  }
  // both modules read their env at call time, but the journal caches nothing
  // across a require — reload so a stale module-level read can't leak in.
  delete require.cache[require.resolve('../journal')];
  delete require.cache[require.resolve('../runner')];
  delete require.cache[require.resolve('../cli')];
  const cli = require('../cli');
  const runner = require('../runner');
  const journalLib = require('../journal');
  try {
    return fn({ cli, runner, journalLib });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('../journal')];
    delete require.cache[require.resolve('../runner')];
    delete require.cache[require.resolve('../cli')];
  }
}

function captureStdout(fn) {
  const chunks = [];
  const real = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  const prevExitCode = process.exitCode;
  try {
    fn();
  } finally {
    process.stdout.write = real;
    process.exitCode = prevExitCode;
  }
  return chunks.join('');
}

function tempWorkflowsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-wf-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

test('list: prints name and description from each workflow\'s own meta', () => {
  const dir = tempWorkflowsDir({
    'alpha.js': "export const meta = { name: 'alpha', description: 'the first one' }\nreturn 1",
    'beta.js': "export const meta = { name: 'beta', description: 'the second one' }\nreturn 2",
    'notes.md': 'not a workflow',
  });
  try {
    withEnv({ YOKI_WORKFLOWS_DIR: dir }, ({ cli }) => {
      const out = captureStdout(() => cli.cmdList({}));
      assert.match(out, /^alpha\tthe first one$/m);
      assert.match(out, /^beta\tthe second one$/m);
      assert.doesNotMatch(out, /notes/); // non-.js files are not workflows
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list --json emits the same entries as machine-readable JSON', () => {
  const dir = tempWorkflowsDir({
    'alpha.js': "export const meta = { name: 'alpha', description: 'the first one' }\nreturn 1",
  });
  try {
    withEnv({ YOKI_WORKFLOWS_DIR: dir }, ({ cli }) => {
      const parsed = JSON.parse(captureStdout(() => cli.cmdList({ json: true })));
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].name, 'alpha');
      assert.equal(parsed[0].description, 'the first one');
      assert.equal(parsed[0].file, path.join(dir, 'alpha.js'));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list: an unparseable workflow is reported, not swallowed, and never breaks the listing', () => {
  const dir = tempWorkflowsDir({
    'good.js': "export const meta = { name: 'good', description: 'fine' }\nreturn 1",
    'broken.js': 'return 1 // no meta at all',
  });
  try {
    withEnv({ YOKI_WORKFLOWS_DIR: dir }, ({ cli, runner }) => {
      const items = runner.listWorkflows();
      assert.equal(items.length, 2);
      const broken = items.find((i) => i.name === 'broken');
      assert.equal(broken.error, true);
      assert.match(broken.description, /unparseable/);
      const out = captureStdout(() => cli.cmdList({}));
      assert.match(out, /good\tfine/);
      assert.match(out, /broken\t\(unparseable/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list: an empty or missing workflows dir says so instead of printing nothing', () => {
  const dir = tempWorkflowsDir({});
  try {
    withEnv({ YOKI_WORKFLOWS_DIR: dir }, ({ cli }) => {
      assert.match(captureStdout(() => cli.cmdList({})), /no workflows found in/);
    });
    withEnv({ YOKI_WORKFLOWS_DIR: path.join(dir, 'does-not-exist') }, ({ cli, runner }) => {
      assert.deepEqual(runner.listWorkflows(), []);
      assert.match(captureStdout(() => cli.cmdList({})), /no workflows found in/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function seedRun(stateHome, runId, meta, entries) {
  const dir = path.join(stateHome, 'yoki', 'graph', runId);
  fs.mkdirSync(dir, { recursive: true });
  if (meta) fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta));
  if (entries) {
    fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  }
}

test('status: reports the run meta and counts ok/error agent calls from the journal', () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    seedRun(stateHome, 'run-1', { name: 'review', status: 'ok', backend: 'mock' }, [
      { key: 'k1', index: 0, label: 'a', status: 'ok', result: 1, tokens: 120, tokensSource: 'reported' },
      { key: 'k2', index: 1, label: 'b', status: 'retry', attempt: 1, error: '429 rate limited' },
      { key: 'k2', index: 1, label: 'b', status: 'error', error: 'boom' },
      { key: 'k3', index: 2, label: 'c', status: 'ok', result: 3, tokens: 30, tokensSource: 'estimated' },
    ]);
    withEnv({ YOKI_STATE_HOME: stateHome }, ({ cli }) => {
      const out = captureStdout(() => cli.cmdStatus(['run-1'], {}));
      assert.match(out, /run: review \(run-1\)/);
      assert.match(out, /status: ok/);
      assert.match(out, /backend: mock/);
      // The retry line is counted separately, not as a fourth agent call.
      assert.match(out, /agent calls: 3 \(2 ok, 1 error, 1 retried\)/);
      assert.match(out, /tokens: 150 \(120 reported, 30 estimated\) — over 2 agent calls/);
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('status --json carries the meta, the counts and every journal entry', () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    seedRun(stateHome, 'run-2', { name: 'research', status: 'error', backend: 'codex', error: 'nope' }, [
      { key: 'k1', label: 'a', status: 'error', error: 'nope' },
    ]);
    withEnv({ YOKI_STATE_HOME: stateHome }, ({ cli }) => {
      const payload = JSON.parse(captureStdout(() => cli.cmdStatus(['run-2'], { json: true })));
      assert.equal(payload.runId, 'run-2');
      assert.equal(payload.meta.name, 'research');
      assert.equal(payload.agentCalls, 1);
      assert.equal(payload.ok, 0);
      assert.equal(payload.errors, 1);
      assert.equal(payload.entries[0].label, 'a');
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('status: an unknown runId says where it looked and exits non-zero', () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    withEnv({ YOKI_STATE_HOME: stateHome }, ({ cli, journalLib }) => {
      let out;
      const prev = process.exitCode;
      try {
        out = captureStdout(() => {
          cli.cmdStatus(['nope-xyz'], {});
          assert.equal(process.exitCode, 1);
        });
      } finally {
        process.exitCode = prev;
      }
      assert.match(out, /no run found with id nope-xyz/);
      assert.ok(out.includes(journalLib.runDir('nope-xyz')));
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('status: a runId is required', () => {
  withEnv({}, ({ cli }) => {
    assert.throws(() => cli.cmdStatus([], {}), /usage: yoki-graph status <runId> \[--once\|--watch\]/);
  });
});

// ---------------------------------------------------------------------------
// status flag parsing and one-shot-vs-watch routing (through main + argv)
//
// These drive `main` the way a shell does — argv in, exit code and streams
// out — so they catch the two demo bugs the direct cmdStatus/cmdWatch unit
// tests could not: `--once` being consumed as the runId when it precedes the
// positional, and `status` defaulting to a blocking watch instead of one shot.
// ---------------------------------------------------------------------------

/** Fail rather than hang: reject if `p` has not settled within `ms`. */
function withTimeout(p, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms}ms — it blocked`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

/** Run `cli.main()` with the given `status` argv, capturing stdout+stderr and
 *  the resulting exit code without letting either leak or the loop block. */
async function runStatusMain(cli, args) {
  const savedArgv = process.argv;
  const savedExit = process.exitCode;
  const real = { out: process.stdout.write, err: process.stderr.write };
  let text = '';
  process.stdout.write = (chunk) => { text += String(chunk); return true; };
  process.stderr.write = (chunk) => { text += String(chunk); return true; };
  process.argv = ['node', 'cli.js', 'status', ...args];
  process.exitCode = undefined;
  let exitCode;
  try {
    await withTimeout(cli.main(), 5000, `status ${args.join(' ')}`);
    exitCode = process.exitCode;
  } finally {
    process.stdout.write = real.out;
    process.stderr.write = real.err;
    process.argv = savedArgv;
    process.exitCode = savedExit;
  }
  return { text, exitCode };
}

test('parseArgs: --once is a boolean flag before OR after the runId (never eats it)', () => {
  withEnv({}, ({ cli }) => {
    const after = cli.parseArgs(['run-1', '--once']);
    assert.deepEqual(after._, ['run-1']);
    assert.equal(after.once, true);
    // The demo bug: `--once` ahead of the positional swallowed `run-1` as its
    // value, leaving no runId. As a declared boolean it must not.
    const before = cli.parseArgs(['--once', 'run-1']);
    assert.deepEqual(before._, ['run-1']);
    assert.equal(before.once, true);
  });
});

test('status <runId>: defaults to a single render and exits 0 (does not watch)', async () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    seedRun(stateHome, 'run-once', { name: 'review', status: 'ok', backend: 'mock' }, [
      { key: 'k1', index: 0, label: 'a', status: 'ok', result: 1, tokens: 10, tokensSource: 'reported' },
    ]);
    await withEnvAsync({ YOKI_STATE_HOME: stateHome }, async ({ cli }) => {
      const { text, exitCode } = await runStatusMain(cli, ['run-once']);
      assert.match(text, /run: review \(run-once\)/);
      assert.match(text, /agent calls: 1 \(1 ok, 0 error, 0 retried\)/);
      assert.notEqual(exitCode, 1);
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('status <runId> --once: same one-shot render, and works with the flag first too', async () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    seedRun(stateHome, 'run-once2', { name: 'review', status: 'ok', backend: 'mock' }, [
      { key: 'k1', index: 0, label: 'a', status: 'ok', result: 1, tokens: 10, tokensSource: 'reported' },
    ]);
    await withEnvAsync({ YOKI_STATE_HOME: stateHome }, async ({ cli }) => {
      const trailing = await runStatusMain(cli, ['run-once2', '--once']);
      assert.match(trailing.text, /run: review \(run-once2\)/);
      assert.notEqual(trailing.exitCode, 1);
      // Flag ahead of the runId used to print the usage error instead.
      const leading = await runStatusMain(cli, ['--once', 'run-once2']);
      assert.match(leading.text, /run: review \(run-once2\)/);
      assert.doesNotMatch(leading.text, /usage: yoki-graph status/);
      assert.notEqual(leading.exitCode, 1);
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('status <runId> --watch: an already-finished run renders once and exits without polling', async () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    // run.json is already `ok`, so cmdWatch's first poll sees `finished` and
    // returns before its (real, 2s) sleep — the timeout guard proves it.
    seedRun(stateHome, 'run-done', { name: 'review', status: 'ok', backend: 'mock' }, [
      { key: 'k1', index: 0, label: 'a', status: 'ok', result: 1, tokens: 10, tokensSource: 'reported' },
    ]);
    await withEnvAsync({ YOKI_STATE_HOME: stateHome }, async ({ cli }) => {
      const { text, exitCode } = await runStatusMain(cli, ['run-done', '--watch']);
      assert.match(text, /run: review \(run-done\)/);
      assert.match(text, /agent calls: 1 \(1 ok, 0 error, 0 retried\)/);
      assert.notEqual(exitCode, 1);
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('status with no id, and status <unknown>, exit non-zero and never block', async () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    await withEnvAsync({ YOKI_STATE_HOME: stateHome }, async ({ cli }) => {
      const noId = await runStatusMain(cli, []);
      assert.match(noId.text, /usage: yoki-graph status <runId>/);
      assert.equal(noId.exitCode, 1);

      const unknown = await runStatusMain(cli, ['ghost']);
      assert.match(unknown.text, /no run found with id ghost/);
      assert.equal(unknown.exitCode, 1);

      // And --watch on a missing id must not enter the poll loop either.
      const watchUnknown = await runStatusMain(cli, ['ghost', '--watch']);
      assert.match(watchUnknown.text, /no run found with id ghost/);
      assert.equal(watchUnknown.exitCode, 1);
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// status --watch: the final report, and how the journal is read while polling
// ---------------------------------------------------------------------------

/** A stream stand-in that keeps everything written to it. */
function capture() {
  return { text: '', isTTY: false, write(chunk) { this.text += String(chunk); return true; } };
}

/**
 * `withEnv` restores the environment in a synchronous `finally`, so an async
 * body would run its awaits with the overrides already gone (`cmdWatch`
 * would then read the REAL ~/.local/state between polls). This variant
 * awaits the body before restoring.
 */
async function withEnvAsync(overrides, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    process.env[key] = value;
  }
  for (const mod of ['../journal', '../runner', '../cli']) delete require.cache[require.resolve(mod)];
  const cli = require('../cli');
  try {
    return await fn({ cli, runner: require('../runner'), journalLib: require('../journal') });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const mod of ['../journal', '../runner', '../cli']) delete require.cache[require.resolve(mod)];
  }
}

test('watch: the final status report goes to the WATCH stream, and says what it found', async () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    seedRun(stateHome, 'run-watch', { name: 'review', status: 'ok', backend: 'codex' }, [
      { key: 'k1', index: 0, label: 'a', status: 'ok', result: 1, tokens: 120, tokensSource: 'reported', model: 'gpt-5.5', backend: 'codex', durationMs: 1000 },
      { key: 'k2', index: 1, label: 'b', status: 'error', error: 'boom', model: 'gpt-5.5', backend: 'codex' },
    ]);
    await withEnvAsync({ YOKI_STATE_HOME: stateHome }, async ({ cli }) => {
      const stream = capture();
      // Everything the run prints must land HERE. Before cmdStatus took an
      // injectable stream the final report went straight to the real
      // process.stdout, so this assertion could not be written at all — the
      // watch line's own "running 0" was the only thing a test could see,
      // and deleting the final report entirely would still have passed.
      const real = process.stdout.write;
      const leaked = [];
      process.stdout.write = (chunk) => { leaked.push(String(chunk)); return true; };
      try {
        await cli.cmdWatch(['run-watch'], {}, { stream, isTty: false, intervalMs: 0, maxPolls: 3 });
      } finally {
        process.stdout.write = real;
      }
      assert.equal(leaked.join(''), '', 'the final status report leaked to the real stdout');
      assert.match(stream.text, /run: review \(run-watch\)/);
      assert.match(stream.text, /agent calls: 2 \(1 ok, 1 error, 0 retried\)/);
      assert.match(stream.text, /tokens: 120 \(120 reported, 0 estimated\)/);
      assert.match(stream.text, /gpt-5\.5/, 'the per-model table is missing from the final report');
      // And the live line was rendered before it.
      assert.ok(stream.text.indexOf('running 0') < stream.text.indexOf('run: review'));
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('watch: a still-running run keeps polling and only reports once it finishes', async () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cli-state-'));
  try {
    const runDir = path.join(stateHome, 'yoki', 'graph', 'run-live');
    seedRun(stateHome, 'run-live', { name: 'review', status: 'running', backend: 'mock' }, [
      { key: 'k1', index: 0, label: 'a', status: 'ok', result: 1, tokens: 10 },
    ]);
    await withEnvAsync({ YOKI_STATE_HOME: stateHome }, async ({ cli }) => {
      const stream = capture();
      let polls = 0;
      const real = process.stdout.write;
      process.stdout.write = () => true;
      try {
        await cli.cmdWatch(['run-live'], {}, {
          stream,
          isTty: false,
          intervalMs: 0,
          maxPolls: 4,
          sleep: async () => {
            polls += 1;
            if (polls === 2) {
              // A second call lands mid-watch, then the run ends.
              fs.appendFileSync(path.join(runDir, 'journal.jsonl'),
                `${JSON.stringify({ key: 'k2', index: 1, label: 'b', status: 'ok', result: 2, tokens: 20 })}\n`);
              fs.writeFileSync(path.join(runDir, 'run.json'),
                JSON.stringify({ name: 'review', status: 'ok', backend: 'mock' }));
            }
          },
        });
      } finally {
        process.stdout.write = real;
      }
      // The entry appended between polls is in the final report: the
      // incremental tail picked it up rather than the loop caching poll 1's
      // read forever.
      assert.match(stream.text, /agent calls: 2 \(2 ok, 0 error, 0 retried\)/);
      assert.match(stream.text, /tokens: 30 /);
    });
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The end-of-run tables
// ---------------------------------------------------------------------------

test('formatModelTable prints a cached column and hides the backend column for a single-backend run', () => {
  withEnv({}, ({ cli }) => {
    const table = cli.formatModelTable([
      { backend: 'codex', model: 'gpt-5.5', calls: 3, tokens: 5000, cached: 4000, wallMs: 61000 },
      { backend: 'codex', model: 'gpt-5.4-mini', calls: 1, tokens: 900, cached: 0, wallMs: 1000 },
    ]);
    assert.match(table, /model +calls +tokens +cached +wall/);
    assert.doesNotMatch(table, /backend/, 'one backend needs no backend column');
    assert.match(table, /gpt-5\.5 +3 +5000 +4000 +1m01s/);
  });
});

test('formatModelTable adds a backend column once a run mixed backends', () => {
  withEnv({}, ({ cli }) => {
    const table = cli.formatModelTable([
      { backend: 'codex', model: 'gpt-5.5', calls: 1, tokens: 100, cached: 10, wallMs: 1000 },
      { backend: 'omp', model: 'claude-sonnet-5', calls: 1, tokens: 50, cached: 0, wallMs: 1000 },
    ]);
    assert.match(table, /model +backend +calls +tokens +cached +wall/);
    assert.match(table, /codex/);
    assert.match(table, /omp/);
  });
});

test('formatUsage reports cached tokens beside the total, never folded into it', () => {
  withEnv({}, ({ cli }) => {
    const line = cli.formatUsage({
      calls: 2, tokens: 120, reportedTokens: 120, estimatedTokens: 0,
      cachedTokens: 57856, costUsd: 0, hasCost: false,
    });
    assert.match(line, /tokens: 120 \(120 reported, 0 estimated\)/);
    assert.match(line, /57856 cached/);
  });
});
