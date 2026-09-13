'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const escalate = require('../escalate');
const { createApi } = require('../api');
const cli = require('../cli');

async function withStateHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-escalate-'));
  const prev = process.env.YOKI_STATE_HOME;
  process.env.YOKI_STATE_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.YOKI_STATE_HOME;
    else process.env.YOKI_STATE_HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function captureStdout(fn) {
  const chunks = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  return Promise.resolve()
    .then(fn)
    .finally(() => { process.stdout.write = real; })
    .then(() => chunks.join(''));
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

test('enqueue: writes a pending record with consult as the default role', () => withStateHome(() => {
  const rec = escalate.enqueue({ question: 'should we drop the $200 plan?', source: 'workflow' });
  assert.equal(rec.status, 'pending');
  assert.equal(rec.role, 'consult');
  assert.equal(rec.source, 'workflow');
  assert.match(rec.id, /^esc-/);
  assert.deepEqual(escalate.get(rec.id), rec); // round-trips from disk
}));

test('enqueue: a question is required', () => withStateHome(() => {
  assert.throws(() => escalate.enqueue({ question: '   ' }), /a question is required/);
}));

test('enqueue: role can be overridden', () => withStateHome(() => {
  const rec = escalate.enqueue({ question: 'q', role: 'main' });
  assert.equal(rec.role, 'main');
}));

test('list: oldest first, filterable by status; missing dir is empty not an error', () => withStateHome(() => {
  assert.deepEqual(escalate.list(), []); // nothing enqueued yet, dir absent
  const a = escalate.enqueue({ question: 'first' });
  const b = escalate.enqueue({ question: 'second' });
  escalate.update(b.id, { status: 'answered', answer: 'yes' });
  const pending = escalate.list(process.env, { status: 'pending' });
  assert.deepEqual(pending.map((r) => r.id), [a.id]);
  const all = escalate.list();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, a.id); // createdAt order preserved
}));

test('update: merges a patch and stamps updatedAt; an unknown id throws', () => withStateHome(() => {
  const rec = escalate.enqueue({ question: 'q' });
  const next = escalate.update(rec.id, { status: 'answered', answer: '42' });
  assert.equal(next.status, 'answered');
  assert.equal(next.answer, '42');
  assert.ok(next.updatedAt);
  assert.throws(() => escalate.update('esc-does-not-exist', { status: 'failed' }), /not found/);
}));

test('recordPath: a slashed id cannot escape the escalations directory', () => withStateHome((dir) => {
  const p = escalate.recordPath('../../etc/passwd');
  assert.equal(path.dirname(p), escalate.escalationsDir());
  assert.ok(p.startsWith(path.join(dir, 'yoki', 'escalations')));
}));

// ---------------------------------------------------------------------------
// api.escalate() global
// ---------------------------------------------------------------------------

test('api.escalate(): enqueues, emits an escalation event, returns {escalated,id}, calls no model', () => withStateHome(() => {
  const events = [];
  let agentRan = false;
  const backend = {
    name: 'mock', supportsSchemaNatively: true,
    run: async () => { agentRan = true; return { raw: 'x', durationMs: 1, exitCode: 0 }; },
    extractText: (r) => r,
  };
  const api = createApi({
    runId: 'r1',
    journal: { replayAt: () => undefined, append: () => {}, tokensSpent: () => 0 },
    backend, cwd: '/repo', emit: (e) => events.push(e),
  });
  const out = api.escalate('hard question', { label: 'judge', context: 'the diff' });
  assert.equal(out.escalated, true);
  assert.match(out.id, /^esc-/);
  assert.equal(agentRan, false, 'escalate must NOT call a model');
  const evt = events.find((e) => e.type === 'escalation');
  assert.equal(evt.id, out.id);
  assert.equal(evt.role, 'consult');
  const rec = escalate.get(out.id);
  assert.equal(rec.question, 'hard question');
  assert.equal(rec.context, 'the diff');
  assert.equal(rec.runId, 'r1');
}));

// ---------------------------------------------------------------------------
// CLI: list / show / run
// ---------------------------------------------------------------------------

test('cmdEscalate list: shows pending records as JSON', () => withStateHome(async () => {
  const rec = escalate.enqueue({ question: 'q1' });
  const out = await captureStdout(() => cli.cmdEscalate(['list'], { json: true }));
  const parsed = JSON.parse(out);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, rec.id);
}));

test('cmdEscalate run --backend mock: dispatches, writes the answer back, marks answered', () => withStateHome(async () => {
  const rec = escalate.enqueue({ question: 'decide this' });
  await captureStdout(() => cli.cmdEscalate(['run', rec.id], { backend: 'mock', json: true }));
  const after = escalate.get(rec.id);
  assert.equal(after.status, 'answered');
  assert.ok(typeof after.answer === 'string' && after.answer.length > 0);
  assert.equal(after.answeredBy, 'mock');
}));

test('cmdEscalate run: a non-pending escalation is a no-op', () => withStateHome(async () => {
  const rec = escalate.enqueue({ question: 'q' });
  escalate.update(rec.id, { status: 'answered', answer: 'done' });
  const out = await captureStdout(() => cli.cmdEscalate(['run', rec.id], { json: false }));
  assert.match(out, /already answered/);
}));

test('cmdEscalate run: an unknown id is a clear error', () => withStateHome(async () => {
  await assert.rejects(() => cli.cmdEscalate(['run', 'esc-nope'], {}), /not found/);
}));
