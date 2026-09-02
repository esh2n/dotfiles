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
const mockBackend = require('../backends/mock');

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
    // The target IS the design text (source_kind "text"): the script embeds
    // it into the lane prompts itself — no agent transcription round-trip.
    args: { target: 'Design: add a write-through cache in front of the lookup path. On write, update the store then the cache. On read, check the cache first, fall back to the store on miss. No rollback plan is specified.' },
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
    // `gateCommand` attaches a real command gate to the Gate-phase call:
    // `true` exits 0, so the run must reach exactly the same final return it
    // reached before gates existed. The failing-gate half is covered in
    // gate.test.js against `agent()` directly.
    args: { tasks: [{ id: 't1', title: 'Add feature', spec: 'Implement feature X', files: ['pkg/x.go'] }], gateCommand: 'true' },
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
    args: { gateCommand: 'true' },
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
      // TWO DIFFERENT defects at the same file:line, raised by two dimension
      // lanes. The confirmed-finding dedupe key is file + line + normalized
      // title exactly so both survive; under the old file:line key one of
      // them silently vanished, and nothing exercised it. Asserted on the
      // DEFAULT single-provider path, because that is where the old key was
      // wrong too.
      assert.equal(r.findings.length, 2);
      assert.ok(r.findings.every((f) => f.file === 'pkg/foo.go' && f.line === 42),
        'the fixture no longer puts two findings on one line');
      assert.deepEqual(r.findings.map((f) => f.title).sort(),
        ['possible nil dereference', 'unchecked error return']);
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
      assert.deepEqual(r.unscanned, []);
      assert.match(r.report, /old-hook\.js/);
    },
  },
  {
    name: 'go-optimize',
    scriptPath: path.join(GO_WORKFLOWS, 'go-optimize.js'),
    // The default gate here is `go build ./... && go vet ./...`, which the
    // throwaway one-README repo below has nothing to compile — so this run
    // overrides it with a command that exits 0. What the override still
    // exercises is the wiring: the gate runs inside each Propose worktree.
    args: { pkg: './internal/foo', gateCommand: 'true' },
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
// 1a. The `gate` wiring inside those same scripts.
// ---------------------------------------------------------------------------

test('implement/preflight run their Gate-phase command gate and pass it', () => withIsolatedState(async () => {
  for (const [name, args] of [
    ['implement', { tasks: [{ id: 't1', title: 'Add feature', spec: 'Implement feature X' }], gateCommand: 'true' }],
    ['preflight', { gateCommand: 'true' }],
  ]) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-gate-'));
    try {
      const events = [];
      const result = await runner.executeScript({
        scriptPath: path.join(CORE_WORKFLOWS, `${name}.js`),
        args,
        backendName: 'mock',
        cwd,
        mockFile: fixture(name),
        emit: (e) => events.push(e),
      });
      assert.equal(result.status, 'ok', result.error);
      const gates = events.filter((e) => e.type === 'agent-gate');
      assert.equal(gates.length, 1, `${name} attaches exactly one command gate`);
      assert.equal(gates[0].status, 'pass');
      assert.equal(gates[0].gate.command, 'true');
      assert.equal(gates[0].gate.exitCode, 0);
      // The gated call is the one the phase is named after, and it still
      // returned its structured answer rather than being nulled.
      assert.equal(gates[0].phase, 'Gate');
      const end = events.find((e) => e.type === 'agent-end' && e.index === gates[0].index);
      assert.equal(end.status, 'ok');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
}));

test('a workflow given no gateCommand attaches no gate at all (unchanged default behaviour)', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-nogate-'));
  try {
    const events = [];
    const result = await runner.executeScript({
      scriptPath: path.join(CORE_WORKFLOWS, 'preflight.js'),
      args: {},
      backendName: 'mock',
      cwd,
      mockFile: fixture('preflight'),
      emit: (e) => events.push(e),
    });
    assert.equal(result.status, 'ok', result.error);
    assert.equal(result.result.status, 'passed');
    assert.equal(events.some((e) => e.type === 'agent-gate'), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

// ---------------------------------------------------------------------------
// 1b. Provider lanes (MP3): the same three scripts under
//     providers: ["claude", "codex"].
// ---------------------------------------------------------------------------
//
// The codex lanes are still run through the mock backend here — what is
// being tested is the WORKFLOW's half of the bridge (a second lane per
// dimension, the transport envelope unwrapped, provider-tagged findings,
// cross-provider dedupe that keeps the union, a failed lane dropped with a
// note instead of faked), not whether `codex exec` works. yoki-agent's own
// half is pinned by test/agent-cli.test.js, and the helper that joins them
// by test/lanes.test.js.
//
// Each script's fixture carries `<label>@codex/<tier>` entries holding the
// `{ok, result}` envelope the transport subagent would have returned.

/** Every agent-start label the run emitted, in order. */
function labelsOf(events) {
  return events.filter((e) => e.type === 'agent-start').map((e) => e.label);
}

function logsOf(events) {
  return events.filter((e) => e.type === 'log').map((e) => e.message);
}

async function runWithProviders(spec, providers, cwd) {
  const events = [];
  const result = await runner.executeScript({
    scriptPath: spec.scriptPath,
    args: { ...spec.args, providers },
    backendName: 'mock',
    cwd,
    mockFile: fixture(spec.name),
    emit: (e) => events.push(e),
  });
  return { result, events };
}

const REVIEW_SPEC = SCRIPTS.find((s) => s.name === 'review');
const RESEARCH_SPEC = SCRIPTS.find((s) => s.name === 'research');
const DESIGN_REVIEW_SPEC = SCRIPTS.find((s) => s.name === 'design-review');

test('review with providers ["claude","codex"]: one lane per dimension per provider, findings tagged, union kept', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-providers-'));
  try {
    const { result, events } = await runWithProviders(REVIEW_SPEC, ['claude', 'codex'], cwd);
    assert.equal(result.status, 'ok', result.error);
    const labels = labelsOf(events);

    // Every dimension ran twice — once natively, once through a transport
    // agent whose label names the provider and the model it was pointed at.
    assert.ok(labels.includes('review:correctness'), 'the claude lane label changed');
    assert.ok(labels.includes('review:correctness@codex/sonnet'), 'no codex lane for correctness');
    // The security dimension keeps its own opus tier when routed to codex.
    assert.ok(labels.includes('review:security@codex/opus'));

    const findings = result.result.findings;
    // pkg/foo.go:42 "possible nil dereference" was found by BOTH providers
    // with the same title -> one finding carrying both attributions.
    const shared = findings.find((f) => f.title === 'possible nil dereference');
    assert.ok(shared, 'the finding both providers reported disappeared');
    assert.deepEqual(shared.providers.sort(), ['claude', 'codex']);

    // A DIFFERENT defect at the same file:line survives beside it — the
    // dedupe key carries the normalized title. Across providers this is not
    // cosmetic: collapsing by file:line would throw away exactly the second
    // opinion the providers were added for.
    const sameLine = findings.filter((f) => f.file === 'pkg/foo.go' && f.line === 42);
    assert.equal(sameLine.length, 2, 'two different defects on one line collapsed into one');
    assert.deepEqual(sameLine.map((f) => f.title).sort(),
      ['possible nil dereference', 'unchecked error return']);

    // pkg/bar.go was found by codex ONLY -> the union keeps it.
    const codexOnly = findings.find((f) => f.file === 'pkg/bar.go');
    assert.ok(codexOnly, 'the finding only codex reported was dropped — this is not a union');
    assert.deepEqual(codexOnly.providers, ['codex']);
    assert.equal(codexOnly.provider, 'codex');
    assert.match(codexOnly.tag, /\[codex\]/);
    assert.equal(findings.length, 3);

    // Grouped by provider: a shared finding appears under both, so a group
    // reads as "what this provider saw".
    assert.deepEqual(Object.keys(result.result.by_provider).sort(), ['claude', 'codex']);
    assert.equal(result.result.by_provider.claude.length, 2);
    assert.equal(result.result.by_provider.codex.length, 2);

    // Metrics are keyed per provider once there is more than one.
    assert.ok(result.result.metrics['correctness@claude']);
    assert.ok(result.result.metrics['correctness@codex']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('review: a provider lane whose yoki-agent call failed is dropped with a visible note, never faked', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-providers-'));
  try {
    const { result, events } = await runWithProviders(REVIEW_SPEC, ['claude', 'codex'], cwd);
    assert.equal(result.status, 'ok', result.error);
    // The fixture's `review:tests@codex/sonnet` entry is {ok:false, exitCode:2}.
    const note = logsOf(events).find((m) => m.includes('review:tests@codex/sonnet'));
    assert.ok(note, 'the dropped lane was silent — a reader cannot tell coverage was lost');
    assert.match(note, /dropped/);
    assert.match(note, /codex exec exited 1/);
    assert.match(note, /exit 2/);
    // And it contributed nothing: no invented finding stands in for it.
    assert.equal(result.result.metrics['tests@codex'].total, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('research: a claim both providers reached is VERIFIED ONCE, and still credited to both', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-providers-'));
  try {
    const { result, events } = await runWithProviders(RESEARCH_SPEC, ['claude', 'codex'], cwd);
    assert.equal(result.status, 'ok', result.error);
    // Both `search:a1` lanes return the same load-bearing claim from the
    // same source. Verification is the expensive stage — opus at high
    // effort, opening the source itself — and the two copies produce the
    // same prompt under the same label, i.e. literally the same call. It
    // used to be launched twice.
    const verifies = labelsOf(events).filter((l) => l.startsWith('verify:'));
    assert.deepEqual(verifies, ['verify:a1'],
      'the shared claim was verified once per provider instead of once');

    // The merge still credits both providers — deduping the verification
    // must not cost the attribution that makes a second provider worth it.
    const shared = result.result.findings.find((f) => /60 req\/min/.test(f.claim));
    assert.ok(shared, 'the shared claim disappeared');
    assert.deepEqual(shared.providers.sort(), ['claude', 'codex']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('review: a misspelled provider stops the run instead of quietly halving the coverage', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-providers-'));
  try {
    const { result, events } = await runWithProviders(REVIEW_SPEC, ['claude', 'codexx'], cwd);
    // It used to be dropped: the run then executed the claude lanes only,
    // which is byte-for-byte what the default looks like — no error, and no
    // "providers:" log line either, since a single-claude list does not
    // trigger one. A reviewer told they got two providers got one.
    assert.equal(result.status, 'error', 'an unknown provider ran anyway');
    assert.match(result.error, /codexx/);
    assert.match(result.error, /claude, codex, omp, mock/);
    assert.equal(labelsOf(events).length, 0, 'lanes ran before the bad arg was refused');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('review: a provider lane answered by a fixture is delivered but announced as mock', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-providers-'));
  try {
    const { result, events } = await runWithProviders(REVIEW_SPEC, ['claude', 'codex'], cwd);
    assert.equal(result.status, 'ok', result.error);
    // The fixture's `review:performance@codex/sonnet` result carries the
    // `_mock: true` stamp yoki-agent adds when --allow-mock rerouted the
    // call. Without the announcement, canned findings read exactly like
    // "codex reviewed this and found nothing".
    const note = logsOf(events).find((m) => m.includes('review:performance@codex/sonnet'));
    assert.ok(note, 'a fixture-served lane was reported as if the provider had answered');
    assert.match(note, /MOCK/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

/**
 * The invariant that matters most and is easiest to break silently: with
 * `providers` absent, no agent() PROMPT may differ from what it was before
 * providers existed. callKey hashes the prompt, so a changed prompt breaks
 * `--resume` for that call against every journal written before the upgrade
 * — permanently, and with no error to notice.
 *
 * Labels cannot catch it. research.js and design-review.js both feed their
 * per-lane records into a LATER `synthesize` prompt, so a provider field
 * added to those records rewrites a prompt while every label stays
 * identical. Both scripts shipped exactly that until this test existed.
 *
 * Nor can comparing two runs of the current code (no `providers` vs an
 * explicit `["claude"]`): both normalize to the same single-Claude lane and
 * are therefore identically wrong. The assertion has to name the thing that
 * must be absent — provider attribution — not compare the code to itself.
 */
function stubMockPrompts() {
  const original = mockBackend.run;
  const prompts = [];
  mockBackend.run = async (call) => {
    prompts.push({ label: (call.opts && call.opts.label) || '', prompt: call.prompt });
    return original(call);
  };
  return { prompts, restore() { mockBackend.run = original; } };
}

async function promptsFor(spec, args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-prompts-'));
  const stub = stubMockPrompts();
  try {
    const result = await runner.executeScript({
      scriptPath: spec.scriptPath, args, backendName: 'mock', cwd, mockFile: fixture(spec.name),
    });
    assert.equal(result.status, 'ok', result.error);
    return stub.prompts;
  } finally {
    stub.restore();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// The shapes provider attribution takes in a prompt: a JSON field on a
// per-lane record, or the trailing "this ran on more than one provider"
// instruction. None of them may appear when nobody asked for providers.
const PROVIDER_MARKERS = [/"provider"\s*:/, /"providers"\s*:/, /more than one model provider/, /@codex|@omp/];

for (const spec of [REVIEW_SPEC, RESEARCH_SPEC, DESIGN_REVIEW_SPEC]) {
  test(`${spec.name}: with providers absent, no prompt mentions a provider at all`, () => withIsolatedState(async () => {
    for (const args of [spec.args, { ...spec.args, providers: ['claude'] }]) {
      // eslint-disable-next-line no-await-in-loop
      const prompts = await promptsFor(spec, args);
      assert.ok(prompts.length > 0, 'no prompt was captured');
      for (const { label, prompt } of prompts) {
        for (const marker of PROVIDER_MARKERS) {
          assert.doesNotMatch(prompt, marker,
            `${spec.name}'s "${label}" prompt gained provider attribution on the default path — `
            + 'callKey hashes the prompt, so --resume against any older journal is now broken for this call');
        }
      }
    }
  }));
}

test('research/design-review DO carry provider attribution into synthesize once providers are named', () => withIsolatedState(async () => {
  for (const spec of [RESEARCH_SPEC, DESIGN_REVIEW_SPEC]) {
    // eslint-disable-next-line no-await-in-loop
    const prompts = await promptsFor(spec, { ...spec.args, providers: ['claude', 'codex'] });
    const synth = prompts.find((p) => p.label === 'synthesize');
    assert.ok(synth, `${spec.name} made no synthesize call`);
    assert.match(synth.prompt, /more than one model provider/,
      `${spec.name}'s synthesizer was not told the material came from two providers`);
  }
}));

test('review with the default providers is unchanged: same labels, same journal shape', () => withIsolatedState(async () => {
  const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-default-a-'));
  const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-default-b-'));
  try {
    // No `providers` at all vs. an explicit ["claude"] — the two must be the
    // same run, and neither may mention a transport.
    const bare = [];
    const bareRun = await runner.executeScript({
      scriptPath: REVIEW_SPEC.scriptPath, args: REVIEW_SPEC.args, backendName: 'mock',
      cwd: cwdA, mockFile: fixture('review'), emit: (e) => bare.push(e),
    });
    const { result: explicit, events } = await runWithProviders(REVIEW_SPEC, ['claude'], cwdB);

    assert.equal(bareRun.status, 'ok', bareRun.error);
    assert.equal(explicit.status, 'ok');
    assert.deepEqual(labelsOf(events), labelsOf(bare));
    assert.ok(!labelsOf(bare).some((l) => l.includes('@')), 'a default run grew a provider lane');
    assert.deepEqual(explicit.result.findings, bareRun.result.findings);
    // Dimension-keyed metrics, exactly as before providers existed.
    assert.ok(bareRun.result.metrics.correctness);
    assert.ok(explicit.result.metrics.correctness);
  } finally {
    fs.rmSync(cwdA, { recursive: true, force: true });
    fs.rmSync(cwdB, { recursive: true, force: true });
  }
}));

test('research with providers ["claude","codex"]: searchers fan out per provider and claims dedupe on claim+source', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-providers-'));
  try {
    const { result, events } = await runWithProviders(RESEARCH_SPEC, ['claude', 'codex'], cwd);
    assert.equal(result.status, 'ok', result.error);
    const labels = labelsOf(events);
    assert.ok(labels.includes('search:a1'));
    assert.ok(labels.includes('search:a1@codex/sonnet'));
    assert.ok(labels.includes('search:a2@codex/sonnet'));

    const claims = result.result.findings;
    const shared = claims.find((f) => f.claim.includes('60 req/min'));
    assert.ok(shared);
    assert.deepEqual(shared.providers.sort(), ['claude', 'codex']);
    // A source only codex opened survives.
    const codexOnly = claims.find((f) => f.claim.includes('per API key'));
    assert.ok(codexOnly, 'the claim only codex found was dropped');
    assert.deepEqual(codexOnly.providers, ['codex']);
    assert.equal(claims.length, 3);

    assert.deepEqual(Object.keys(result.result.by_provider).sort(), ['claude', 'codex']);
    // The failed a2 codex lane is reported, not silently empty.
    assert.ok(logsOf(events).some((m) => /search:a2@codex\/sonnet: dropped/.test(m)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('design-review with providers ["claude","codex"]: panel lanes fan out and claims merge across providers', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-providers-'));
  try {
    const { result, events } = await runWithProviders(DESIGN_REVIEW_SPEC, ['claude', 'codex'], cwd);
    assert.equal(result.status, 'ok', result.error);
    const labels = labelsOf(events);
    assert.ok(labels.includes('lane:conventions'));
    assert.ok(labels.includes('lane:conventions@codex/sonnet'));
    assert.ok(labels.includes('lane:security@codex/opus'));

    const findings = result.result.findings;
    const shared = findings.find((f) => f.claim.includes('rollback'));
    assert.ok(shared);
    assert.deepEqual(shared.providers.sort(), ['claude', 'codex']);
    assert.match(shared.tag, /\[claude\+codex\]/);
    const codexOnly = findings.find((f) => f.claim.includes('per tenant'));
    assert.ok(codexOnly, 'the finding only codex raised was dropped');
    assert.deepEqual(codexOnly.providers, ['codex']);
    assert.equal(findings.length, 2);
    assert.deepEqual(Object.keys(result.result.by_provider).sort(), ['claude', 'codex']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

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
  backendModule.run = async ({ prompt, model, effort, schema, agentType, cwd, sandbox, opts = {} }) => {
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
      ({ args } = backendModule.buildArgv({ model, cwd, schema, schemaFilePath, agentType, sandbox }));
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
        // Sandbox authority is per call, not per run. collect-diff writes the
        // mktemp patch file and says so; every reviewer lane — the calls whose
        // prompts are built out of those untrusted diff hunks — lands on
        // codex's own read-only default instead of the blanket
        // workspace-write this backend used to hardcode for everything.
        assert.deepEqual(collect.args.slice(0, 6), ['exec', '--skip-git-repo-check', '-C', cwd, '-s', 'workspace-write']);
        const lanes = stub.captured.filter((c) => c.label !== 'collect-diff');
        assert.ok(lanes.length > 0, 'no non-collect calls were captured');
        for (const call of lanes) {
          assert.equal(call.args[call.args.indexOf('-s') + 1], 'read-only', `${call.label} was not read-only`);
        }
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

/**
 * A claim two lanes both raise, where one lane's copy is CONFIRMED and the
 * other's comes back `unverified`. The merge used to take the whole
 * higher-C+I record, so the unverified copy could overwrite the confirmed
 * one — and `unverified` findings are explicitly excluded from the verdict
 * ("Derive the verdict from the weight of the CONFIRMED findings only"). A
 * defect a provider actually confirmed would silently stop counting.
 */
test('design-review: a confirmed claim is never downgraded by an unverified duplicate', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-downgrade-'));
  const mockFile = path.join(cwd, 'downgrade.mock.json');
  const claim = 'the cache has no rollback plan';
  // conventions raises it at C8/I8 and its verify CONFIRMS.
  // architecture raises the same claim HIGHER, at C9/I9, and its verify
  // comes back unverified — the exact collision.
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: {
      source_kind: 'text', design_summary: 'a write-through cache design for the lookup path with no rollback plan specified',
      grounding: [], missing: [], checklists: [],
    },
    'lane:conventions': { findings: [{ claim, severity_confidence: 8, importance: 8, doc_ref: '', load_bearing: true }], open_questions: [] },
    'lane:architecture': { findings: [{ claim, severity_confidence: 9, importance: 9, doc_ref: '', load_bearing: true }], open_questions: [] },
    'lane:security': { findings: [], open_questions: [] },
    'lane:wording': { findings: [], open_questions: [] },
    'lane:release': { findings: [], open_questions: [] },
    'verify:conventions': { verdict: 'confirmed', reason: 'the design text has no rollback section' },
    'verify:architecture': { verdict: 'unverified', reason: 'could not establish it from the design text' },
    synthesize: { verdict: 'proceed', report: 'r' },
  }));
  try {
    const result = await runner.executeScript({
      scriptPath: DESIGN_REVIEW_SPEC.scriptPath, args: { target: 'a cache design' },
      backendName: 'mock', cwd, mockFile,
    });
    assert.equal(result.status, 'ok', result.error);
    assert.equal(result.result.findings.length, 1, 'the confirmed claim left the confirmed set');
    assert.equal(result.result.unverified.length, 0, 'the confirmed claim was downgraded to unverified');
    assert.match(result.result.findings[0].tag, /\[verified\]/);
    // The code-enforced floor can only fire on a CONFIRMED finding, so the
    // downgrade also used to let a C9/I9 defect through as "proceed".
    assert.equal(result.result.verdict, 'proceed-with-changes');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

/**
 * The 2026-09-02 fabrication incident, pinned: an ingest agent that could not
 * fill the gather schema truthfully was schema-retried into submitting
 * placeholder garbage, which then flowed to all 11 downstream agents
 * unchecked. The fix is an `error` escape hatch plus abort gates in the
 * script — these tests prove each gate actually cuts the panel off.
 */
async function runDesignReviewGate(mockFile, args = DESIGN_REVIEW_SPEC.args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-ingest-gate-'));
  try {
    const events = [];
    const result = await runner.executeScript({
      scriptPath: DESIGN_REVIEW_SPEC.scriptPath, args,
      backendName: 'mock', cwd, mockFile, emit: (e) => events.push(e),
    });
    return { result, events };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/** No panel lane, verifier, or synthesizer may start once ingest is refused. */
function assertPanelNeverStarted(events) {
  const labels = labelsOf(events);
  assert.deepEqual(labels, ['gather'],
    `agents ran past the ingest gate: ${labels.join(', ')}`);
}

test('design-review: an ingest error aborts the run before any panel lane starts', () => withIsolatedState(async () => {
  const { result, events } = await runDesignReviewGate(fixture('design-review-error'));
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result.error, 'cannot read target');
  assertPanelNeverStarted(events);
}));

test('design-review: a too-short design_summary is refused as suspected fabrication', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-short-summary-'));
  const mockFile = path.join(cwd, 'short-summary.mock.json');
  // The incident's exact shape: schema-passing garbage ("test") in the
  // summary field, submitted under retry pressure.
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: { source_kind: 'text', design_summary: 'test', grounding: [], missing: [], checklists: [] },
  }));
  try {
    const { result, events } = await runDesignReviewGate(mockFile);
    assert.equal(result.status, 'ok', result.error);
    assert.match(result.result.error, /too short/);
    assert.match(result.result.error, /suspected placeholder/);
    assertPanelNeverStarted(events);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('design-review: a file target with no design_path aborts — the panel cannot re-read a design nobody located', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-no-path-'));
  const mockFile = path.join(cwd, 'no-path.mock.json');
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: {
      source_kind: 'file',
      design_summary: 'a design read from a file whose path the ingest agent failed to return',
      grounding: [], missing: [], checklists: [],
    },
  }));
  try {
    const { result, events } = await runDesignReviewGate(mockFile);
    assert.equal(result.status, 'ok', result.error);
    assert.match(result.result.error, /no design_path/);
    assertPanelNeverStarted(events);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

/**
 * source_kind is cross-checked in CODE against what TARGET itself reads as.
 * An omitted or wrong classification used to fall through to the text
 * branch, presenting a bare file path to every lane as "DESIGN TEXT
 * (verbatim, authoritative)".
 */
const GATE_SUMMARY = 'a long enough faithful summary of the cache design under review';

test('design-review: a source_kind contradicting the target itself is refused', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-kind-mismatch-'));
  const mockFile = path.join(cwd, 'mismatch.mock.json');
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: { source_kind: 'text', design_summary: GATE_SUMMARY, grounding: [], missing: [], checklists: [] },
  }));
  try {
    // The target is unmistakably a file path — a "text" classification would
    // hand the lanes the path itself as the design.
    const { result, events } = await runDesignReviewGate(mockFile, { target: '/tmp/some-design.md' });
    assert.equal(result.status, 'ok', result.error);
    assert.match(result.result.error, /reads as "file"/);
    assertPanelNeverStarted(events);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('design-review: a missing source_kind is refused instead of falling through to the text branch', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-kind-missing-'));
  const mockFile = path.join(cwd, 'missing-kind.mock.json');
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: { design_summary: GATE_SUMMARY, grounding: [], missing: [], checklists: [] },
  }));
  try {
    const { result, events } = await runDesignReviewGate(mockFile);
    assert.equal(result.status, 'ok', result.error);
    assert.match(result.result.error, /invalid source_kind/);
    assertPanelNeverStarted(events);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('design-review: a relative design_path is refused — lanes would resolve it differently', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-relative-path-'));
  const mockFile = path.join(cwd, 'relative.mock.json');
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: { source_kind: 'file', design_path: 'docs/design.md', design_summary: GATE_SUMMARY, grounding: [], missing: [], checklists: [] },
  }));
  try {
    const { result, events } = await runDesignReviewGate(mockFile, { target: '/tmp/some-design.md' });
    assert.equal(result.status, 'ok', result.error);
    assert.match(result.result.error, /not absolute/);
    assertPanelNeverStarted(events);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('design-review: a lane that cannot read the design is dropped with a visible note, never faked', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-lane-error-'));
  const mockFile = path.join(cwd, 'lane-error.mock.json');
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: { source_kind: 'text', design_summary: GATE_SUMMARY, grounding: [], missing: [], checklists: [] },
    'lane:conventions': { error: 'cannot read the design file' },
    'lane:architecture': { findings: [], open_questions: [] },
    'lane:security': { findings: [], open_questions: [] },
    'lane:wording': { findings: [], open_questions: [] },
    'lane:release': { findings: [], open_questions: [] },
    synthesize: { verdict: 'proceed', report: 'r' },
  }));
  try {
    const { result, events } = await runDesignReviewGate(mockFile);
    assert.equal(result.status, 'ok', result.error);
    const note = logsOf(events).find((m) => m.includes('lane:conventions'));
    assert.ok(note, 'the dropped lane was silent — a reader cannot tell coverage was lost');
    assert.match(note, /dropped — cannot read the design file/);
    assert.equal(result.result.findings.length, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('design-review: a url target skips the non-claude transport lanes with a note (their sandboxes have no network)', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-url-skip-'));
  const mockFile = path.join(cwd, 'url-skip.mock.json');
  fs.writeFileSync(mockFile, JSON.stringify({
    gather: { source_kind: 'url', design_summary: GATE_SUMMARY, grounding: [], missing: [], checklists: [] },
    'lane:conventions': { findings: [], open_questions: [] },
    'lane:architecture': { findings: [], open_questions: [] },
    'lane:security': { findings: [], open_questions: [] },
    'lane:wording': { findings: [], open_questions: [] },
    'lane:release': { findings: [], open_questions: [] },
    synthesize: { verdict: 'proceed', report: 'r' },
  }));
  try {
    const events = [];
    const result = await runner.executeScript({
      scriptPath: DESIGN_REVIEW_SPEC.scriptPath,
      args: { target: 'https://example.com/design', providers: ['claude', 'codex'] },
      backendName: 'mock', cwd, mockFile, emit: (e) => events.push(e),
    });
    assert.equal(result.status, 'ok', result.error);
    const labels = labelsOf(events);
    assert.ok(labels.includes('lane:conventions'), 'the claude lanes must still run');
    assert.ok(!labels.some((l) => l.includes('@codex')), 'a codex lane ran against a url it cannot fetch');
    const note = logsOf(events).find((m) => /skipped — url target/.test(m));
    assert.ok(note, 'the skipped transport lanes left no visible note');
    assert.match(note, /@codex/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

// ---------------------------------------------------------------------------
// 4. The anti-fabrication escape hatch, one row per workflow.
// ---------------------------------------------------------------------------
//
// Every first-stage/ingest prompt PROMISES "return only the `error` field";
// each row proves the schema actually ACCEPTS an error-only answer and the
// script aborts with that reason. This is exactly the test that catches a
// `required` list quietly tightening again: an error-only entry then fails
// loose validation, is retried once with "missing required property ..."
// folded into the prompt — the 2026-09-02 incident's exact pressure, now
// applied to the honest answer — and the run errors out instead of aborting
// cleanly.

const HATCH_MSG = 'cannot fill this truthfully';
const HATCH = [
  { name: 'research', label: 'plan-angles', args: { question: 'q?' } },
  { name: 'review', label: 'collect-diff', args: {} },
  { name: 'acceptance', label: 'ground', args: { criteria: [{ id: 'c1', text: 'x' }] } },
  { name: 'code-study', label: 'map', args: { target: 't', questions: ['q'] } },
  {
    name: 'preflight', label: 'collect-diff', args: {},
    expect(r) { assert.equal(r.status, 'error'); assert.equal(r.error, HATCH_MSG); },
  },
  { name: 'implement', label: 'load-tasks', args: { tasksFile: '/tmp/tasks.md' } },
  { name: 'go-optimize', label: 'resolve', args: { pkg: './x' }, dir: GO_WORKFLOWS },
  { name: 'design-review', label: 'gather', args: { target: 'a design text target' } },
  // deliberate's grounding scout has no schema: its hatch is the "ERROR:"
  // text sentinel, gated the same way.
  {
    name: 'deliberate', label: 'scout',
    args: { question: 'q?', grounding: ['README.md'] },
    entry: `ERROR: ${HATCH_MSG}`,
    expect(r) { assert.equal(r.error, `ERROR: ${HATCH_MSG}`); },
  },
];

for (const spec of HATCH) {
  test(`${spec.name}: the ${spec.label} escape hatch accepts an error-only answer and aborts the run`, () => withIsolatedState(async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-hatch-'));
    const mockFile = path.join(cwd, 'hatch.mock.json');
    fs.writeFileSync(mockFile, JSON.stringify({ [spec.label]: spec.entry || { error: HATCH_MSG } }));
    try {
      const result = await runner.executeScript({
        scriptPath: path.join(spec.dir || CORE_WORKFLOWS, `${spec.name}.js`),
        args: spec.args, backendName: 'mock', cwd, mockFile,
      });
      assert.equal(result.status, 'ok', result.error);
      if (spec.expect) spec.expect(result.result);
      else assert.equal(result.result.error, HATCH_MSG);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }));
}

test('stocktake: a failed scan is dropped with its reason — the other areas still get audited', () => withIsolatedState(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-stocktake-drop-'));
  const mockFile = path.join(cwd, 'drop.mock.json');
  fs.writeFileSync(mockFile, JSON.stringify({
    'scan:skills': { error: 'cannot read ~/.claude/skills' },
    'scan:hooks': { area: 'hooks', items: [{ name: 'old-hook.js', verdict: 'drop-candidate', evidence: 'not wired' }] },
    'scan:mcp': { area: 'mcp', items: [] },
    'scan:memory': { area: 'memory', items: [] },
    'scan:freshness': { area: 'freshness', items: [] },
    synthesize: 'report body',
  }));
  try {
    const events = [];
    const result = await runner.executeScript({
      scriptPath: path.join(CORE_WORKFLOWS, 'stocktake.js'),
      args: {}, backendName: 'mock', cwd, mockFile, emit: (e) => events.push(e),
    });
    assert.equal(result.status, 'ok', result.error);
    // NOT aborted: the four good areas still produce the report...
    assert.equal(result.result.error, undefined);
    assert.deepEqual(result.result.drop_candidates, ['[hooks] old-hook.js — not wired']);
    // ...and the failed one is named with its reason, attributed by the
    // script's own scanner key, both in the result and in a log line.
    assert.deepEqual(result.result.unscanned, ['[skills] cannot read ~/.claude/skills']);
    assert.ok(logsOf(events).some((m) => /not scanned — \[skills\] cannot read/.test(m)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));
