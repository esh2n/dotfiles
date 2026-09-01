'use strict';

/**
 * T21: proves every workflow script this repo ships is backend-neutral by
 * running it end to end against the mock backend via `runner.executeScript`
 * (the exact function `yoki-graph run <name> --backend mock --mock <file>`
 * dispatches into — see cli.js's `cmdRun`) with a canned fixture per script
 * under `fixtures/<name>.mock.json`. Each assertion checks the run reached
 * its final `return` (`status === 'ok'`) and that the returned object has
 * the shape the script's own top-level `return` produces. See API.md's
 * results table for the phases-reached / return-keys this run produced.
 *
 * Two more tests (review, research) prove backend selection itself is real
 * — not just the mock path — by stubbing ONLY the codex/omp backends'
 * `run()` (the part that would spawn `codex`/`omp`) so it calls that
 * backend's own real `buildArgv()` and returns a canned answer instead of
 * spawning anything. This captures the exact argv codex/omp would receive
 * ("the printed argv") with zero process ever spawned. A literal
 * `--dry-run` flag was considered instead, but is the wrong tool here:
 * `agent()`'s dry-run branch (api.js) returns its placeholder BEFORE ever
 * calling `ctx.backend.run`/`buildArgv` for ANY backend — by design, dry-run
 * never touches the backend at all, so there is no codex/omp-specific argv
 * to assert on that path. The argv-capture stub below is the one that
 * actually exercises codex/omp `buildArgv` while spawning nothing.
 *
 * Every test isolates YOKI_STATE_HOME (journal) and
 * YOKI_GRAPH_GUARD_STATE_DIR (the daily-cap counter shared with the real
 * workflow-guard.sh hook) — see runner.test.js's header for why touching
 * real shared state here would be wrong.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const runner = require('../runner');
const codexBackend = require('../backends/codex');
const ompBackend = require('../backends/omp');

const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const CORE_WORKFLOWS = path.join(PROFILES_ROOT, 'core', 'workflows');
const GO_WORKFLOWS = path.join(PROFILES_ROOT, 'packs', 'go', 'workflows');
const FIXTURES = path.join(__dirname, 'fixtures');

function fixture(name) {
  return path.join(FIXTURES, `${name}.mock.json`);
}

function sh(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'pipe' });
}

/** A throwaway git repo with one commit — needed only by go-optimize's
 *  Propose phase, whose `isolation: 'worktree'` agent() calls create a real
 *  `git worktree` off `cwd`'s HEAD (see worktree.js / worktree.test.js). */
function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-repo-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  sh('git', ['add', 'README.md'], dir);
  sh('git', ['commit', '-q', '-m', 'init'], dir);
  return dir;
}

/** Isolate the journal + daily-cap-guard state some real `~/.claude`
 *  directory would otherwise share across every test in this file (and
 *  with any real workflow-guard.sh launch on this machine). Mirrors
 *  runner.test.js's helper of the same name. */
function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-guarddir-'));
  const prevStateHome = process.env.YOKI_STATE_HOME;
  const prevGuardDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = guardDir;
  delete require.cache[require.resolve('../journal')];
  delete require.cache[require.resolve('../guard')];
  return Promise.resolve(fn()).finally(() => {
    if (prevStateHome === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevStateHome;
    if (prevGuardDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevGuardDir;
    delete require.cache[require.resolve('../journal')];
    delete require.cache[require.resolve('../guard')];
    fs.rmSync(stateHome, { recursive: true, force: true });
    fs.rmSync(guardDir, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// 1. The full script matrix, each run end to end under --backend mock.
// ---------------------------------------------------------------------------
//
// name -> { scriptPath, args, needsGitRepo, assertResult(result) }
// `assertResult` checks the shape the script's own top-level `return`
// documents (see each workflow's `meta`/comments) against the canned
// fixture — not just "did not throw".

const SCRIPTS = [
  {
    name: 'acceptance',
    scriptPath: path.join(CORE_WORKFLOWS, 'acceptance.js'),
    args: { criteria: [{ id: 'c1', text: 'Feature X works end to end' }, { id: 'c2', text: 'Errors are handled and surfaced' }], scope: 'feature X' },
    assertResult(r) {
      assert.equal(r.verdict.total, 2);
      assert.equal(r.verdict.automated, 1);
      assert.equal(r.rows.length, 2);
      assert.equal(r.gaps.length, 1);
      assert.match(r.report, /cannot ship/);
    },
  },
  {
    name: 'code-study',
    scriptPath: path.join(CORE_WORKFLOWS, 'code-study.js'),
    args: { target: 'github.com/example/repo', questions: ['How does the handler dispatch work?'] },
    assertResult(r) {
      assert.equal(r.target, 'github.com/example/repo');
      assert.equal(r.answers.length, 1);
      assert.equal(r.checked, 1);
      assert.equal(r.refuted, 0);
      assert.match(r.report, /Process/);
    },
  },
  {
    name: 'deliberate',
    scriptPath: path.join(CORE_WORKFLOWS, 'deliberate.js'),
    args: { question: 'Should we use X or Y for the queue?' },
    assertResult(r) {
      assert.equal(r.options.length, 5);
      assert.equal(r.criteria.length, 2);
      assert.equal(r.gate.length, 0); // every option's claims were []
      assert.ok(r.convergence);
      assert.match(r.answer, /Option 1/);
    },
  },
  {
    name: 'design-review',
    scriptPath: path.join(CORE_WORKFLOWS, 'design-review.js'),
    args: { target: 'a write-through cache design, see fixture design_text' },
    assertResult(r) {
      assert.equal(r.verdict, 'proceed-with-changes');
      assert.equal(r.findings.length, 1);
      assert.equal(r.unverified.length, 0);
      assert.equal(r.open_questions.length, 1);
    },
  },
  {
    name: 'implement',
    scriptPath: path.join(CORE_WORKFLOWS, 'implement.js'),
    args: { tasks: [{ id: 't1', title: 'Add feature', spec: 'Implement feature X', files: ['pkg/x.go'] }] },
    assertResult(r) {
      assert.equal(r.tasks.length, 1);
      assert.equal(r.tasks[0].status, 'done');
      assert.equal(r.schedule.length, 1);
      assert.deepEqual(r.schedule[0].batches, [['t1']]);
      assert.equal(r.gate.ok, true);
      assert.equal(r.delivery, null); // delivery defaults to 'none'
    },
  },
  {
    name: 'preflight',
    scriptPath: path.join(CORE_WORKFLOWS, 'preflight.js'),
    args: {},
    assertResult(r) {
      assert.equal(r.status, 'passed');
      assert.equal(r.branch, 'feature/x');
      assert.equal(r.auto_fixed.length, 1);
      assert.equal(r.judge_rejected.length, 0);
      assert.equal(r.report_only.length, 0);
    },
  },
  {
    name: 'research',
    scriptPath: path.join(CORE_WORKFLOWS, 'research.js'),
    args: { question: 'What is the API rate limit?' },
    assertResult(r) {
      assert.match(r.report, /60 requests\/minute/);
      assert.deepEqual(r.unknowns, ['exact burst allowance is undocumented']);
    },
  },
  {
    name: 'review',
    scriptPath: path.join(CORE_WORKFLOWS, 'review.js'),
    args: {},
    assertResult(r) {
      assert.equal(r.intent, 'add a caching layer in front of the lookup path');
      assert.equal(r.findings.length, 1);
      assert.equal(r.findings[0].file, 'pkg/foo.go');
      assert.equal(r.unverified.length, 0);
      assert.ok(r.metrics.correctness);
    },
  },
  {
    name: 'stocktake',
    scriptPath: path.join(CORE_WORKFLOWS, 'stocktake.js'),
    args: {},
    assertResult(r) {
      assert.equal(r.drop_candidates.length, 1);
      assert.equal(r.fix_items.length, 1);
      assert.match(r.report, /old-hook\.js/);
    },
  },
  {
    name: 'go-optimize',
    scriptPath: path.join(GO_WORKFLOWS, 'go-optimize.js'),
    args: { pkg: './internal/foo' },
    needsGitRepo: true,
    assertResult(r) {
      assert.equal(r.pkg, './internal/foo');
      assert.equal(r.targetBench, '^BenchmarkFoo$');
      assert.equal(r.accepted.length, 1);
      assert.equal(r.accepted[0].angle, 'allocation');
      // rejected = algorithmic (explicit correctness-gate failure in the fixture)
      // + concurrency-contention/runtime-knob (no fixture entry -> the mock
      // backend's schema placeholder, which defaults correctnessOk to false).
      assert.equal(r.rejected.length, 3);
      assert.equal(r.delivery, null); // delivery defaults to 'draft'
    },
  },
];

for (const spec of SCRIPTS) {
  test(`${spec.name}: runs end to end under --backend mock and reaches its final return`, () => withIsolatedState(async () => {
    const cwd = spec.needsGitRepo ? makeTempRepo() : fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-cwd-'));
    try {
      const result = await runner.executeScript({
        scriptPath: spec.scriptPath,
        args: spec.args,
        backendName: 'mock',
        cwd,
        mockFile: fixture(spec.name),
      });
      assert.equal(result.status, 'ok', result.error);
      assert.ok(result.result, `${spec.name} returned no result`);
      spec.assertResult(result.result);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }));
}

// ---------------------------------------------------------------------------
// 2. codex/omp argv-capture: review + research, no process ever spawned.
// ---------------------------------------------------------------------------
//
// Stubs ONLY `<backend>.run` (the part that would call spawnCollect) so it
// instead calls the backend's own real `buildArgv()` — proving the exact
// codex/omp CLI invocation each label would produce — and returns a canned
// JSON/text answer built from a small per-script fixture, without spawning
// anything. Restores the original `run` after each test (same monkeypatch
// pattern runner.test.js uses for the mock backend).

function stubBackendRun(backendModule, fixtureByLabel) {
  const original = backendModule.run;
  const captured = [];
  backendModule.run = async ({ prompt, model, effort, schema, agentType, cwd, opts = {} }) => {
    const label = opts.label || prompt;
    let args;
    if (backendModule.name === 'codex') {
      // Mirrors codex.js's own run(): a real schema still gets a real
      // temp schema file (buildArgv only emits --output-schema when a path
      // is given) — no process is spawned either way.
      let schemaFilePath = null;
      if (schema) {
        schemaFilePath = path.join(os.tmpdir(), `yoki-graph-argv-capture-schema-${Math.random().toString(16).slice(2)}.json`);
        fs.writeFileSync(schemaFilePath, JSON.stringify(schema));
      }
      ({ args } = backendModule.buildArgv({ model, cwd, schema, schemaFilePath, agentType }));
      if (schemaFilePath) { try { fs.unlinkSync(schemaFilePath); } catch { /* best-effort */ } }
    } else {
      // omp.js's own run(): buildArgv, then --thinking is appended for
      // effort (omp.js does this in run(), not in buildArgv).
      ({ args } = backendModule.buildArgv({ prompt, model, agentType }));
      if (effort) args = [...args, '--thinking', effort];
    }
    captured.push({ label, cmd: backendModule.name, args });
    const value = Object.prototype.hasOwnProperty.call(fixtureByLabel, label) ? fixtureByLabel[label] : (schema ? {} : `[argv-capture] ${label}`);
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return { raw, stderr: '', durationMs: 0, exitCode: 0 };
  };
  return {
    captured,
    restore() { backendModule.run = original; },
  };
}

const REVIEW_ARGV_FIXTURE = {
  'collect-diff': { diff_file: '/tmp/x.patch', files_changed: 1, intent: 'x', langs: [], touches: [], checklists: [] },
  grounding: 'none',
  'review:correctness': { findings: [] },
  'review:security': { findings: [] },
  'review:performance': { findings: [] },
  'review:tests': { findings: [] },
  'review:simplification': { findings: [] },
};

// Known dedicated schema-flag names across the real backends (claude
// --json-schema, codex --output-schema); omp has none of these — schema.js
// falls back to folding the instruction into the prompt text itself.
const SCHEMA_FLAGS = ['--json-schema', '--output-schema', '--schema'];

const RESEARCH_ARGV_FIXTURE = {
  'plan-angles': { angles: [{ key: 'a1', goal: 'g1' }] },
  'search:a1': { findings: [], unknowns: [] },
  synthesize: 'done',
};

for (const backendModule of [codexBackend, ompBackend]) {
  test(`review under --backend ${backendModule.name}: real argv captured, no process spawned`, () => withIsolatedState(async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-argv-'));
    const stub = stubBackendRun(backendModule, REVIEW_ARGV_FIXTURE);
    try {
      const result = await runner.executeScript({
        scriptPath: path.join(CORE_WORKFLOWS, 'review.js'),
        args: {},
        backendName: backendModule.name,
        cwd,
      });
      assert.equal(result.status, 'ok', result.error);
      assert.equal(result.result.findings.length, 0); // no findings survived the (empty) fixture
      assert.ok(stub.captured.length > 0, 'no backend call was captured — argv-capture stub never ran');
      const collect = stub.captured.find((c) => c.label === 'collect-diff');
      assert.ok(collect, 'collect-diff call was not routed through the stubbed backend');
      if (backendModule.name === 'codex') {
        assert.deepEqual(collect.args.slice(0, 6), ['exec', '--skip-git-repo-check', '-C', cwd, '-s', 'workspace-write']);
        assert.ok(collect.args.includes('--output-schema')); // collect-diff carries COLLECT_SCHEMA
        assert.equal(collect.args[collect.args.length - 1], '-');
        const security = stub.captured.find((c) => c.label === 'review:security');
        assert.ok(security);
        assert.notEqual(security.args[security.args.indexOf('-m') + 1], 'opus'); // resolved through harness-models.json
      } else {
        assert.deepEqual(collect.args.slice(0, 2), ['-p', '--mode']);
        assert.ok(collect.args.includes('--no-extensions'));
        // omp has no dedicated schema flag — schema.js enforces it by
        // folding the instruction INTO the prompt argv element instead (and
        // real omp.js's own run() appends --thinking AFTER that prompt when
        // effort is set, so "the last arg" isn't reliably the prompt either
        // — check for the absence of a known schema FLAG, not a substring
        // scan over every arg).
        assert.ok(!collect.args.some((a) => SCHEMA_FLAGS.includes(a)));
        const security = stub.captured.find((c) => c.label === 'review:security');
        assert.ok(security);
        assert.notEqual(security.args[security.args.indexOf('--model') + 1], 'opus');
      }
    } finally {
      stub.restore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }));

  test(`research under --backend ${backendModule.name}: real argv captured, no process spawned`, () => withIsolatedState(async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-argv-'));
    const stub = stubBackendRun(backendModule, RESEARCH_ARGV_FIXTURE);
    try {
      const result = await runner.executeScript({
        scriptPath: path.join(CORE_WORKFLOWS, 'research.js'),
        args: { question: 'irrelevant for argv capture' },
        backendName: backendModule.name,
        cwd,
      });
      assert.equal(result.status, 'ok', result.error);
      assert.ok(stub.captured.length > 0);
      const plan = stub.captured.find((c) => c.label === 'plan-angles');
      assert.ok(plan, 'plan-angles call was not routed through the stubbed backend');
      const synth = stub.captured.find((c) => c.label === 'synthesize');
      assert.ok(synth, 'synthesize call was not routed through the stubbed backend');
      if (backendModule.name === 'codex') {
        assert.ok(plan.args.includes('--output-schema')); // plan-angles carries PLAN_SCHEMA
        assert.ok(!synth.args.includes('--output-schema')); // synthesize has no schema
      } else {
        // Neither call gets a dedicated schema FLAG on omp (see the review
        // test's comment above) — plan-angles' schema is enforced by
        // folding the instruction into its prompt argv element instead.
        assert.ok(!plan.args.some((a) => SCHEMA_FLAGS.includes(a)));
        assert.ok(!synth.args.some((a) => SCHEMA_FLAGS.includes(a)));
      }
    } finally {
      stub.restore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }));
}
