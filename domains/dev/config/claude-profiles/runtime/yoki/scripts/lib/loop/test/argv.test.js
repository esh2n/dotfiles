'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  buildCommand,
  ompGuardPath,
  resolveSandbox,
  DEFAULT_SANDBOX,
  CLAUDE_READ_ONLY_DENIED_TOOLS,
  OMP_READ_ONLY_TOOLS,
} = require('../argv');

test('claude: minimal argv (no model, no resume)', () => {
  const { cmd, args, stdin } = buildCommand({ harness: 'claude', prompt: 'hello', cwd: '/repo' });
  assert.equal(cmd, 'claude');
  assert.deepEqual(args, ['-p', 'hello', '--output-format', 'json']);
  assert.equal(stdin, null);
});

test('claude: adds --model and --resume when given', () => {
  const { args } = buildCommand({
    harness: 'claude',
    prompt: 'hello',
    cwd: '/repo',
    model: 'claude-sonnet-5',
    resumeSessionId: 'sess-1',
  });
  assert.deepEqual(args, ['-p', 'hello', '--output-format', 'json', '--model', 'claude-sonnet-5', '--resume', 'sess-1']);
});

test('codex: minimal argv puts the prompt on stdin, not argv, with a trailing "-"', () => {
  const { cmd, args, stdin } = buildCommand({ harness: 'codex', prompt: 'do the thing', cwd: '/repo' });
  assert.equal(cmd, 'codex');
  assert.deepEqual(args, ['exec', '--skip-git-repo-check', '-C', '/repo', '-s', 'workspace-write', '--json', '-']);
  assert.equal(stdin, 'do the thing');
});

test('codex: -m and resume land before the trailing "-"', () => {
  const { args } = buildCommand({
    harness: 'codex',
    prompt: 'p',
    cwd: '/repo',
    model: 'gpt-5.1-codex',
    resumeSessionId: 'thread-9',
  });
  assert.deepEqual(args, [
    'exec',
    '--skip-git-repo-check',
    '-C',
    '/repo',
    '-s',
    'workspace-write',
    '--json',
    '-m',
    'gpt-5.1-codex',
    'resume',
    'thread-9',
    '-',
  ]);
});

// --- sandbox ---------------------------------------------------------------
// A loop is standing work in a repo, so workspace-write stays the default —
// but it is now a default rather than a hardcoded flag, so an unattended
// inbox-driven loop (whose prompt is written by artifact viewers) can be
// installed read-only.

test('codex: --sandbox narrows the run; workspace-write stays the default', () => {
  assert.equal(DEFAULT_SANDBOX, 'workspace-write');
  const { args } = buildCommand({ harness: 'codex', prompt: 'p', cwd: '/repo', sandbox: 'read-only' });
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  const dflt = buildCommand({ harness: 'codex', prompt: 'p', cwd: '/repo' });
  assert.equal(dflt.args[dflt.args.indexOf('-s') + 1], 'workspace-write');
});

test('codex: an unknown --sandbox value is rejected, never silently passed to codex', () => {
  assert.throws(
    () => buildCommand({ harness: 'codex', prompt: 'p', cwd: '/repo', sandbox: 'yolo' }),
    /unknown --sandbox "yolo"/
  );
  assert.equal(resolveSandbox(''), 'workspace-write');
});

test('claude: --sandbox read-only denies every write tool instead of being ignored', () => {
  const { args } = buildCommand({ harness: 'claude', prompt: 'p', cwd: '/repo', sandbox: 'read-only' });
  const denied = args[args.indexOf('--disallowedTools') + 1];
  assert.ok(args.includes('--disallowedTools'), 'read-only must reach the claude argv');
  for (const tool of CLAUDE_READ_ONLY_DENIED_TOOLS) {
    assert.ok(denied.split(',').includes(tool), `${tool} must be denied`);
  }
  // A shell is a write tool — leaving Bash enabled would make this cosmetic.
  assert.ok(denied.split(',').includes('Bash'));
});

test('claude: workspace-write (the default) adds no restriction flag', () => {
  const dflt = buildCommand({ harness: 'claude', prompt: 'p', cwd: '/repo' });
  assert.deepEqual(dflt.args, ['-p', 'p', '--output-format', 'json']);
  const explicit = buildCommand({ harness: 'claude', prompt: 'p', cwd: '/repo', sandbox: 'workspace-write' });
  assert.ok(!explicit.args.includes('--disallowedTools'));
});

test('omp: --sandbox read-only restricts the tool allow-list instead of being ignored', () => {
  const { args } = buildCommand({ harness: 'omp', prompt: 'p', cwd: '/repo', homeDir: '/home/u', sandbox: 'read-only' });
  const enabled = args[args.indexOf('--tools') + 1].split(',');
  assert.deepEqual(enabled, OMP_READ_ONLY_TOOLS);
  for (const writeTool of ['write', 'edit', 'bash', 'ast_edit', 'task']) {
    assert.ok(!enabled.includes(writeTool), `${writeTool} must not be enabled read-only`);
  }
  // The guard extension and the prompt still come last, unchanged.
  assert.equal(args[args.length - 1], 'p');
  assert.ok(args.includes('--no-extensions'));
});

test('omp: workspace-write (the default) adds no --tools restriction', () => {
  const dflt = buildCommand({ harness: 'omp', prompt: 'p', cwd: '/repo', homeDir: '/home/u' });
  assert.ok(!dflt.args.includes('--tools'));
  const explicit = buildCommand({ harness: 'omp', prompt: 'p', cwd: '/repo', homeDir: '/home/u', sandbox: 'workspace-write' });
  assert.ok(!explicit.args.includes('--tools'));
});

test('an unknown --sandbox is rejected on claude and omp too, not just codex', () => {
  assert.throws(() => buildCommand({ harness: 'claude', prompt: 'p', cwd: '/repo', sandbox: 'yolo' }), /unknown --sandbox "yolo"/);
  assert.throws(
    () => buildCommand({ harness: 'omp', prompt: 'p', cwd: '/repo', homeDir: '/home/u', sandbox: 'yolo' }),
    /unknown --sandbox "yolo"/
  );
});

test('no harness silently accepts-and-discards --sandbox read-only', () => {
  // The regression this pins: `yoki-loop install inbox --harness omp
  // --sandbox read-only` used to validate the flag and then run with full
  // write access. Every harness must show read-only somewhere in its argv.
  const cases = [
    buildCommand({ harness: 'claude', prompt: 'p', cwd: '/repo', sandbox: 'read-only' }),
    buildCommand({ harness: 'codex', prompt: 'p', cwd: '/repo', sandbox: 'read-only' }),
    buildCommand({ harness: 'omp', prompt: 'p', cwd: '/repo', homeDir: '/home/u', sandbox: 'read-only' }),
  ];
  for (const { cmd, args } of cases) {
    const restricted = args.includes('-s') || args.includes('--disallowedTools') || args.includes('--tools');
    assert.ok(restricted, `${cmd} must express read-only in its argv`);
  }
});

test('omp: minimal argv keeps the guard flags and puts the prompt last', () => {
  const homeDir = '/home/u';
  const { cmd, args, stdin } = buildCommand({ harness: 'omp', prompt: 'hi', cwd: '/repo', homeDir });
  assert.equal(cmd, 'omp');
  assert.deepEqual(args, ['-p', '--mode', 'json', '--no-extensions', '-e', ompGuardPath(homeDir), 'hi']);
  assert.equal(stdin, null);
});

test('omp: --model is inserted before the guard flags', () => {
  const homeDir = '/home/u';
  const { args } = buildCommand({ harness: 'omp', prompt: 'hi', cwd: '/repo', homeDir, model: 'anthropic/claude-haiku-5' });
  assert.deepEqual(args, [
    '-p',
    '--mode',
    'json',
    '--model',
    'anthropic/claude-haiku-5',
    '--no-extensions',
    '-e',
    ompGuardPath(homeDir),
    'hi',
  ]);
});

test('omp: ignores resumeSessionId — the spec\'s omp line has no resume flag', () => {
  const homeDir = '/home/u';
  const { args } = buildCommand({ harness: 'omp', prompt: 'hi', cwd: '/repo', homeDir, resumeSessionId: 'whatever' });
  assert.ok(!args.includes('whatever'));
});

test('ompGuardPath: resolves under <home>/.omp/agent/extensions/yoki-bridge.ts', () => {
  assert.equal(ompGuardPath('/Users/u'), path.join('/Users/u', '.omp', 'agent', 'extensions', 'yoki-bridge.ts'));
});

test('buildCommand: rejects an unknown harness', () => {
  assert.throws(() => buildCommand({ harness: 'gemini', prompt: 'x', cwd: '.' }), /unknown harness/);
});
