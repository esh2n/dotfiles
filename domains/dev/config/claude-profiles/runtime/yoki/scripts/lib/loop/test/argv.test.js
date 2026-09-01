'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildCommand, ompGuardPath } = require('../argv');

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
