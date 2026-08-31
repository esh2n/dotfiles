'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, extractPathsGlobs, matchesAnyGlob } = require('../pre-rules-context');

function makeFixture() {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-rules-context-claude-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-rules-context-state-'));

  fs.mkdirSync(path.join(claudeDir, 'rules', 'golang'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'rules', 'common'), { recursive: true });

  fs.writeFileSync(
    path.join(claudeDir, 'rules', 'golang', 'coding-style.md'),
    ['---', 'paths:', '  - "**/*.go"', '  - "**/go.mod"', '---', '', '# Go Coding Style', '', 'Never ignore error returns.'].join('\n')
  );
  fs.writeFileSync(
    path.join(claudeDir, 'rules', 'common', 'git-workflow.md'),
    ['---', '---', '', '# Git Workflow', '', 'Always-on, no paths: key.'].join('\n')
  );

  return { claudeDir, stateDir };
}

function cleanup(fixture) {
  fs.rmSync(fixture.claudeDir, { recursive: true, force: true });
  fs.rmSync(fixture.stateDir, { recursive: true, force: true });
}

function withEnv(fixture, fn) {
  const savedClaudeDir = process.env.CLAUDE_DIR;
  const savedStateDir = process.env.YOKI_STATE_DIR;
  process.env.CLAUDE_DIR = fixture.claudeDir;
  process.env.YOKI_STATE_DIR = fixture.stateDir;
  try {
    return fn();
  } finally {
    if (savedClaudeDir === undefined) delete process.env.CLAUDE_DIR;
    else process.env.CLAUDE_DIR = savedClaudeDir;
    if (savedStateDir === undefined) delete process.env.YOKI_STATE_DIR;
    else process.env.YOKI_STATE_DIR = savedStateDir;
  }
}

function preToolUsePayload(overrides) {
  return JSON.stringify(Object.assign(
    {
      session_id: 'sess-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/main.go' },
    },
    overrides
  ));
}

test('extractPathsGlobs: reads the paths: list, [] for a rule with none', () => {
  const withPaths = ['---', 'paths:', '  - "**/*.go"', '  - "**/go.mod"', '---', 'body'].join('\n');
  assert.deepEqual(extractPathsGlobs(withPaths), ['**/*.go', '**/go.mod']);

  const withoutPaths = ['---', '---', 'body'].join('\n');
  assert.deepEqual(extractPathsGlobs(withoutPaths), []);
});

test('matchesAnyGlob: matches a **/*.go glob against a .go file', () => {
  assert.equal(matchesAnyGlob(['**/*.go'], '/repo/main.go'), true);
  assert.equal(matchesAnyGlob(['**/*.go'], '/repo/main.py'), false);
});

test('run: a matching Edit on a .go file injects the paths:-scoped rule body', () => {
  const fixture = makeFixture();
  try {
    withEnv(fixture, () => {
      const result = run(preToolUsePayload({}));
      assert.ok(result && typeof result === 'object', 'expected a structured hook result, not a passthrough string');
      assert.ok(Array.isArray(result.additionalContext));
      assert.equal(result.additionalContext.length, 1);
      assert.match(result.additionalContext[0], /Go Coding Style/);
      assert.match(result.additionalContext[0], /Never ignore error returns/);
      // frontmatter itself must not leak into the injected body
      assert.ok(!result.additionalContext[0].includes('paths:'));
    });
  } finally {
    cleanup(fixture);
  }
});

test('run: a non-matching file (no .go/.mod touched) is a pure passthrough', () => {
  const fixture = makeFixture();
  try {
    withEnv(fixture, () => {
      const raw = preToolUsePayload({ tool_input: { file_path: '/repo/README.md' } });
      const result = run(raw);
      assert.equal(result, raw);
    });
  } finally {
    cleanup(fixture);
  }
});

test('run: an always-on rule (no paths: key) is never injected by this hook', () => {
  const fixture = makeFixture();
  try {
    withEnv(fixture, () => {
      const result = run(preToolUsePayload({ tool_input: { file_path: '/repo/anything.go' } }));
      const joined = result.additionalContext.join('\n');
      assert.ok(!joined.includes('Git Workflow'));
    });
  } finally {
    cleanup(fixture);
  }
});

test('run: the same rule is injected only once per session (cursor dedupe)', () => {
  const fixture = makeFixture();
  try {
    withEnv(fixture, () => {
      const first = run(preToolUsePayload({}));
      assert.ok(Array.isArray(first.additionalContext) && first.additionalContext.length === 1);

      const second = run(preToolUsePayload({ tool_input: { file_path: '/repo/other.go' } }));
      assert.equal(second, preToolUsePayload({ tool_input: { file_path: '/repo/other.go' } }));
    });
  } finally {
    cleanup(fixture);
  }
});

test('run: a different session_id gets the rule injected again', () => {
  const fixture = makeFixture();
  try {
    withEnv(fixture, () => {
      run(preToolUsePayload({}));
      const otherSession = run(preToolUsePayload({ session_id: 'sess-2' }));
      assert.ok(Array.isArray(otherSession.additionalContext) && otherSession.additionalContext.length === 1);
    });
  } finally {
    cleanup(fixture);
  }
});

test('run: a non-Read/Write/Edit tool is a pure passthrough', () => {
  const fixture = makeFixture();
  try {
    withEnv(fixture, () => {
      const raw = preToolUsePayload({ tool_name: 'Bash', tool_input: { command: 'go build ./...' } });
      assert.equal(run(raw), raw);
    });
  } finally {
    cleanup(fixture);
  }
});

test('run: malformed JSON input fails open (returned unchanged)', () => {
  const fixture = makeFixture();
  try {
    withEnv(fixture, () => {
      assert.equal(run('not json'), 'not json');
    });
  } finally {
    cleanup(fixture);
  }
});
