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
      { key: 'k1', label: 'a', status: 'ok', result: 1 },
      { key: 'k2', label: 'b', status: 'error', error: 'boom' },
      { key: 'k3', label: 'c', status: 'ok', result: 3 },
    ]);
    withEnv({ YOKI_STATE_HOME: stateHome }, ({ cli }) => {
      const out = captureStdout(() => cli.cmdStatus(['run-1'], {}));
      assert.match(out, /run: review \(run-1\)/);
      assert.match(out, /status: ok/);
      assert.match(out, /backend: mock/);
      assert.match(out, /agent calls: 3 \(2 ok, 1 error\)/);
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
    assert.throws(() => cli.cmdStatus([], {}), /usage: yoki-graph status <runId>/);
  });
});
