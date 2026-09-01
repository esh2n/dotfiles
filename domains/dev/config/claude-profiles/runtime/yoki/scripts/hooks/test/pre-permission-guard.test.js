'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../pre-permission-guard.js');

function withClaudeDir(claudeDir, fn) {
  const saved = Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_DIR') ? process.env.CLAUDE_DIR : undefined;
  process.env.CLAUDE_DIR = claudeDir;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_DIR;
    else process.env.CLAUDE_DIR = saved;
  }
}

function writePermissions(claudeDir, denyEntries) {
  const dir = path.join(claudeDir, '.yoki');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'permissions.json'), JSON.stringify({ deny: denyEntries }), 'utf8');
}

function freshClaudeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permission-guard-'));
}

function payload(toolName, toolInput) {
  return JSON.stringify({ tool_name: toolName, tool_input: toolInput });
}

function isDeny(result, pattern) {
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, `yoki permission-guard: ${pattern}`);
}

function isPassthrough(result, raw) {
  assert.equal(result, raw);
}

test('Bash: a trailing-glob deny pattern (rm -rf /*) blocks the literal command', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf /*)', reason: 'wildcard' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf /*' });
    isDeny(hook.run(raw), 'Bash(rm -rf /*)');
  });
});

// The whole point of the pattern: a trailing '*' glued to the last token is a
// PREFIX wildcard. Read as an exact match it fired on nothing real, and since
// to-codex.js cannot express these as execpolicy tokens, this hook is their
// only enforcement point on Codex and omp.
test('Bash: rm -rf /* blocks a real destructive command under / (prefix wildcard)', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf /*)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'rm -rf /etc/foo' })), 'Bash(rm -rf /*)');
  });
});

test('Bash: > /dev/* blocks a raw device redirect', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(> /dev/*)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: '> /dev/sda' })), 'Bash(> /dev/*)');
  });
});

test('Bash: rm -rf ~/* blocks a home-directory wipe', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf ~/*)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'rm -rf ~/x' })), 'Bash(rm -rf ~/*)');
  });
});

test('Bash: a trailing-glob pattern still does not match a command outside its prefix', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf /*)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf ./build' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('Bash: a prefix pattern (ending " *") blocks the bare command and any trailing args', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(git reset --hard *)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'git reset --hard' })), 'Bash(git reset --hard *)');
    isDeny(hook.run(payload('Bash', { command: 'git reset --hard HEAD~1' })), 'Bash(git reset --hard *)');
  });
});

test('Bash: a prefix pattern does not match a command that only shares a text prefix', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(git reset --hard *)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'git reset --hardcoded-thing' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('Edit: a double-star extension glob (**/*.pem) blocks a nested path', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)', reason: 'secret' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Edit', { file_path: '/repo/certs/server.pem' });
    isDeny(hook.run(raw), 'Edit(**/*.pem)');
  });
});

test('Edit: the same glob also blocks a top-level file with no directory', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Edit', { file_path: 'server.pem' });
    isDeny(hook.run(raw), 'Edit(**/*.pem)');
  });
});

test('Edit: Edit(**/.env) blocks .env but not .env.local', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/.env)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Edit', { file_path: '/repo/.env' })), 'Edit(**/.env)');
    const raw = payload('Edit', { file_path: '/repo/.env.local' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('Write and MultiEdit tool names are also matched against Edit(...) deny patterns', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.key)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Write', { file_path: '/repo/id.key' })), 'Edit(**/*.key)');
    isDeny(hook.run(payload('MultiEdit', { file_path: '/repo/id.key', edits: [] })), 'Edit(**/*.key)');
  });
});

test('a non-matching file passes through untouched', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Edit', { file_path: '/repo/src/index.js' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('a tool this hook does not gate (Read) always passes through', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Read', { file_path: '/repo/server.pem' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('a missing permissions.json fails open (passthrough), not an exception', () => {
  const claudeDir = freshClaudeDir(); // no .yoki/permissions.json written
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf /*' });
    assert.doesNotThrow(() => isPassthrough(hook.run(raw), raw));
  });
});

test('a malformed permissions.json fails open', () => {
  const claudeDir = freshClaudeDir();
  fs.mkdirSync(path.join(claudeDir, '.yoki'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.yoki', 'permissions.json'), '{not json', 'utf8');
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf /*' });
    assert.doesNotThrow(() => isPassthrough(hook.run(raw), raw));
  });
});

test('malformed stdin (not JSON) passes through unchanged', () => {
  const result = hook.run('not json at all');
  assert.equal(result, 'not json at all');
});

test('matchBash: a trailing "*" glued to the last token is a prefix wildcard', () => {
  assert.equal(hook.matchBash('rm -rf ~/*', 'rm -rf ~/*'), true);
  assert.equal(hook.matchBash('rm -rf ~/*', 'rm -rf ~/foo'), true);
  assert.equal(hook.matchBash('rm -rf ~/*', 'rm -rf /foo'), false);
  assert.equal(hook.matchBash('rm -rf /*', 'rm -rf /etc/foo'), true);
  assert.equal(hook.matchBash('> /dev/*', '> /dev/sda'), true);
  assert.equal(hook.matchBash('>> /dev/*', '>> /dev/null'), true);
});

test('matchBash: " *" keeps word-boundary semantics (a prefix star is not a bare prefix)', () => {
  assert.equal(hook.matchBash('git push *', 'git push'), true);
  assert.equal(hook.matchBash('git push *', 'git push --force'), true);
  assert.equal(hook.matchBash('git push *', 'git pushx'), false);
});

test('matchBash: a pattern with no trailing star stays an exact match', () => {
  assert.equal(hook.matchBash('shutdown now', 'shutdown now'), true);
  assert.equal(hook.matchBash('shutdown now', 'shutdown now -h'), false);
});

test('globToRegExp: "**/" matches zero or more directories', () => {
  const re = hook.globToRegExp('**/*.pem');
  assert.ok(re.test('a.pem'));
  assert.ok(re.test('a/b/c.pem'));
  assert.ok(!re.test('a.key'));
});
