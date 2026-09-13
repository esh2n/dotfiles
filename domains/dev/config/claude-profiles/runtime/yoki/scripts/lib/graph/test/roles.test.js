'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const roles = require('../roles');
const { createApi } = require('../api');

const TABLE = {
  _comment: 'docs',
  main: { backend: 'deepseek', model: 'flash' },
  consult: { backend: 'codex', model: 'opus', effort: 'high' },
  deterministic: { backend: 'local', model: 'qwen' },
};

// ---------------------------------------------------------------------------
// roles.resolve
// ---------------------------------------------------------------------------

test('resolve: no role requested returns null (not an error)', () => {
  assert.equal(roles.resolve(undefined, TABLE), null);
  assert.equal(roles.resolve('', TABLE), null);
  assert.equal(roles.resolve('   ', TABLE), null);
});

test('resolve: a known role returns its backend/model/effort', () => {
  assert.deepEqual(roles.resolve('main', TABLE), { backend: 'deepseek', model: 'flash', effort: undefined });
  assert.deepEqual(roles.resolve('consult', TABLE), { backend: 'codex', model: 'opus', effort: 'high' });
  assert.deepEqual(roles.resolve('deterministic', TABLE), { backend: 'local', model: 'qwen', effort: undefined });
});

test('resolve: an unknown role is a FATAL error listing the valid roles', () => {
  const err = (() => { try { roles.resolve('consutl', TABLE); return null; } catch (e) { return e; } })();
  assert.ok(err instanceof roles.UnknownRoleError);
  assert.equal(err.fatal, true);
  assert.match(err.message, /unknown role "consutl"/);
  assert.match(err.message, /consult, deterministic, main/); // sorted, _comment excluded
});

test('resolve: the _comment documentation key is not a role', () => {
  assert.throws(() => roles.resolve('_comment', TABLE), /unknown role "_comment"/);
});

test('resolve: no table at all is still a clear error, not a silent null', () => {
  assert.throws(() => roles.resolve('main', null), /no core\/harness-roles\.json found/);
});

// ---------------------------------------------------------------------------
// loadHarnessRoles reads the real repo file
// ---------------------------------------------------------------------------

test('loadHarnessRoles: the committed core/harness-roles.json defines main/consult/deterministic', () => {
  // walk up from this test file to the dotfiles root
  const repoRoot = path.resolve(__dirname, '../../../../../../../../../..');
  roles.clearCache();
  const table = roles.loadHarnessRoles(repoRoot);
  assert.ok(table, `expected to load ${roles.harnessRolesPath(repoRoot)}`);
  assert.deepEqual(roles.resolve('main', table), { backend: 'deepseek', model: 'flash', effort: undefined });
  assert.equal(roles.resolve('consult', table).backend, 'codex');
  assert.equal(roles.resolve('deterministic', table).backend, 'local');
});

// ---------------------------------------------------------------------------
// api.js integration: agent(p, {role}) resolves through the table
// ---------------------------------------------------------------------------

function captureApi({ runBackendName = 'codex', harnessModels, harnessRoles = TABLE } = {}) {
  const events = [];
  const captured = [];
  const backend = {
    name: runBackendName,
    supportsSchemaNatively: true,
    run: async (call) => { captured.push(call); return { raw: 'ok', durationMs: 1, exitCode: 0 }; },
    extractText: (raw) => raw,
  };
  const api = createApi({
    runId: 'r1',
    journal: { replayAt: () => undefined, append: () => {}, tokensSpent: () => 0 },
    backend,
    cwd: '/repo',
    harnessModels,
    harnessRoles,
    emit: (e) => events.push(e),
  });
  return { api, events, captured };
}

test('agent({role}): consult resolves to the codex backend, opus id, high effort', async () => {
  // run backend == codex so the role's backend hits the injected fake rather
  // than loading the real codex module.
  const harnessModels = { codex: { opus: 'gpt-5.6-sol' } };
  const { api, events, captured } = captureApi({ runBackendName: 'codex', harnessModels });
  await api.agent('adjudicate this', { label: 'judge', role: 'consult' });
  const start = events.find((e) => e.type === 'agent-start');
  assert.equal(start.backend, 'codex');
  assert.equal(start.model, 'gpt-5.6-sol'); // opus tier resolved through the map
  assert.equal(start.role, 'consult');
  assert.equal(captured[0].effort, 'high'); // role effort reached the backend
});

test('agent({role}): explicit model/effort override the role defaults', async () => {
  const harnessModels = { codex: { opus: 'gpt-5.6-sol', haiku: 'gpt-5.4-mini' } };
  const { api, events, captured } = captureApi({ runBackendName: 'codex', harnessModels });
  await api.agent('p', { label: 'j', role: 'consult', model: 'haiku', effort: 'low' });
  const start = events.find((e) => e.type === 'agent-start');
  assert.equal(start.model, 'gpt-5.4-mini'); // explicit model won over role's opus
  assert.equal(captured[0].effort, 'low'); // explicit effort won over role's high
});

test('agent({role}): main routes to the deepseek backend name (resolved before run)', async () => {
  // run backend is mock; role main -> deepseek loads the real deepseek module,
  // whose run() throws "key not set" with no env — no network. We only assert
  // the resolution recorded in agent-start.
  const harnessModels = { deepseek: { flash: 'deepseek-flash' } };
  const { api, events } = captureApi({ runBackendName: 'mock', harnessModels });
  const result = await api.agent('everyday task', { label: 'main-task', role: 'main' });
  const start = events.find((e) => e.type === 'agent-start');
  assert.equal(start.backend, 'deepseek');
  assert.equal(start.model, 'deepseek-flash');
  assert.equal(start.role, 'main');
  assert.equal(result, null); // deepseek run failed (no key) -> agent() null, as designed
});

test('agent({role}): an unknown role is fatal and propagates through parallel()', async () => {
  const { api } = captureApi({ runBackendName: 'mock' });
  await assert.rejects(
    () => api.parallel([() => api.agent('p', { label: 'x', role: 'bogus' })]),
    /unknown role "bogus"/,
  );
});
