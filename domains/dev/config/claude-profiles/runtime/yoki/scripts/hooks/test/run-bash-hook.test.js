'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const RUN_BASH_HOOK = path.join(__dirname, '..', 'run-bash-hook.js');
const GIT_GUARD = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..', 'personal', 'hooks', 'git-guard.sh'
);

function runBashHook(harness, rawPayload, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [RUN_BASH_HOOK, '--harness', harness, GIT_GUARD, ...extraArgs],
    { input: JSON.stringify(rawPayload), encoding: 'utf8' }
  );
  return result;
}

function parseStdoutJson(stdout) {
  const trimmed = String(stdout || '').trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

test('git-guard.sh exists at the expected path (sanity check for the fixture path)', () => {
  const fs = require('fs');
  assert.equal(fs.existsSync(GIT_GUARD), true, `expected git-guard.sh at ${GIT_GUARD}`);
});

// ---------------------------------------------------------------------------
// codex: force-push is denied, with git-guard's own reason surfaced
// ---------------------------------------------------------------------------

test('codex Bash force-push is denied with git-guard reason in codex-shaped output', () => {
  const raw = {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-codex-1',
    cwd: process.cwd(),
    tool_name: 'Bash',
    tool_input: { command: 'git push --force origin main' },
  };

  const result = runBashHook('codex', raw);

  assert.equal(result.status, 0, `expected exit 0 (deny via JSON, not exit-2): stderr=${result.stderr}`);
  const parsed = parseStdoutJson(result.stdout);
  assert.ok(parsed, `expected JSON stdout, got: ${result.stdout}`);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /Force push blocked/);
});

// ---------------------------------------------------------------------------
// codex: a harmless command is allowed
// ---------------------------------------------------------------------------

test('codex Bash "git status" is allowed (no deny, exit 0)', () => {
  const raw = {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-codex-2',
    cwd: process.cwd(),
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  };

  const result = runBashHook('codex', raw);

  assert.equal(result.status, 0);
  const parsed = parseStdoutJson(result.stdout);
  // git-guard prints nothing when it has no opinion; translateResponse's
  // pass-through leaves that empty stdout untouched.
  assert.equal(parsed, null, `expected no decision JSON, got: ${result.stdout}`);
});

// ---------------------------------------------------------------------------
// omp: force-push (-f) is denied, rendered as omp's tool_call block shape
// ---------------------------------------------------------------------------

test('omp bash "git push -f" is denied as an omp tool_call block', () => {
  const raw = {
    event: 'tool_call',
    payload: {
      toolName: 'bash',
      input: { command: 'git push -f origin main' },
    },
    ctx: {
      session_id: 'sess-omp-1',
      cwd: process.cwd(),
    },
  };

  const result = runBashHook('omp', raw);

  assert.equal(result.status, 0);
  const parsed = parseStdoutJson(result.stdout);
  assert.ok(parsed, `expected JSON stdout, got: ${result.stdout}`);
  assert.equal(parsed.block, true);
  assert.match(parsed.reason, /Force push blocked/);
});

// ---------------------------------------------------------------------------
// codex: apply_patch updating one tracked file passes git-guard untouched
// (single-file patch does not fan out; the payload is Edit, not Bash, so
// git-guard's own `[ "$TOOL" != "Bash" ] && exit 0` guard applies)
// ---------------------------------------------------------------------------

test('codex apply_patch updating a tracked file passes git-guard untouched', () => {
  const patchText = [
    '*** Begin Patch',
    '*** Update File: existing-file.txt',
    '@@',
    '-old line',
    '+new line',
    '*** End Patch',
  ].join('\n');

  const raw = {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-codex-3',
    cwd: process.cwd(),
    tool_name: 'apply_patch',
    tool_input: { command: patchText },
  };

  const result = runBashHook('codex', raw);

  assert.equal(result.status, 0);
  const parsed = parseStdoutJson(result.stdout);
  assert.equal(parsed, null, `expected git-guard to stay silent for a non-Bash tool, got: ${result.stdout}`);
});

// ---------------------------------------------------------------------------
// Fail-open behaviors mirrored from the personal settings.json bash wrapper
// ---------------------------------------------------------------------------

test('missing hook file fails open: stderr warning, exit 0, no stdout', () => {
  const result = spawnSync(
    process.execPath,
    [RUN_BASH_HOOK, '--harness', 'codex', '/nonexistent/does-not-exist.sh'],
    { input: '{}', encoding: 'utf8' }
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /hook not found, failing open/);
});

test('bash syntax error fails open: stderr warning, exit 0, no stdout', () => {
  const fs = require('fs');
  const os = require('os');
  const badHook = path.join(os.tmpdir(), `run-bash-hook-bad-${process.pid}.sh`);
  fs.writeFileSync(badHook, '#!/usr/bin/env bash\nif [ true\n'); // unterminated if

  try {
    const result = spawnSync(
      process.execPath,
      [RUN_BASH_HOOK, '--harness', 'codex', badHook],
      { input: '{}', encoding: 'utf8' }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /syntax check failed, failing open/);
  } finally {
    fs.unlinkSync(badHook);
  }
});
