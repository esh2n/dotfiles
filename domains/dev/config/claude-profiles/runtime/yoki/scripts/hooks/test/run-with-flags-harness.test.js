'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER_PATH = path.join(__dirname, '..', 'run-with-flags.js');
const HOOK_ID = 'fixture-hook';
const REL_SCRIPT_PATH = 'hooks/fixture-hook.js';

// A tiny fixture hook exercised under every harness: denies a Bash command
// containing "forbidden" (exit 2 + stderr, the classic Claude convention)
// and denies a Write/Edit whose file_path contains "BLOCKED" (JSON
// hookSpecificOutput deny, the newer convention) — everything else is
// allowed (no opinion).
const FIXTURE_HOOK_SOURCE = `'use strict';

function run(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {};
  }

  const toolName = payload.tool_name;
  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};

  if (toolName === 'Bash') {
    const command = String(input.command || '');
    if (command.includes('forbidden')) {
      return { exitCode: 2, stderr: 'no forbidden commands' };
    }
    return {};
  }

  if (toolName === 'Write' || toolName === 'Edit') {
    const target = String(input.file_path || '');
    if (target.includes('BLOCKED')) {
      return {
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: payload.hook_event_name,
            permissionDecision: 'deny',
            permissionDecisionReason: 'blocked file: ' + target
          }
        }),
        exitCode: 0
      };
    }
    return {};
  }

  return {};
}

module.exports = { run };
`;

function makePluginRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-with-flags-harness-'));
  const hooksDir = path.join(root, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'fixture-hook.js'), FIXTURE_HOOK_SOURCE);
  return root;
}

// Deliberately narrow: no YOKI_HARNESS/YOKI_DRY_RUN/etc leak in from the
// environment this test itself happens to run under.
function safeEnv(pluginRoot, overrides = {}) {
  return Object.assign(
    {
      PATH: process.env.PATH || '',
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      YOKI_HOOK_PROFILE: 'standard',
      YOKI_DISABLED_HOOKS: ''
    },
    overrides
  );
}

function runRunner(pluginRoot, args, stdinPayload, envOverrides) {
  const input = typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload);
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    input,
    encoding: 'utf8',
    cwd: pluginRoot,
    env: safeEnv(pluginRoot, envOverrides)
  });
}

// --- Claude-path regression: byte-for-byte identical with vs without --harness claude ---

const RECORDED_CLAUDE_PAYLOADS = [
  {
    session_id: 'sess-claude-1',
    transcript_path: '/tmp/claude-1.jsonl',
    cwd: '/tmp/proj',
    hook_event_name: 'PreToolUse',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' }
  },
  {
    session_id: 'sess-claude-2',
    transcript_path: '/tmp/claude-2.jsonl',
    cwd: '/tmp/proj',
    hook_event_name: 'PreToolUse',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command: 'echo forbidden' }
  },
  {
    session_id: 'sess-claude-3',
    transcript_path: '/tmp/claude-3.jsonl',
    cwd: '/tmp/proj',
    hook_event_name: 'PreToolUse',
    permission_mode: 'default',
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/proj/BLOCKED.txt', content: 'x' }
  }
];

test('claude path: output is byte-for-byte identical with and without --harness claude', () => {
  const pluginRoot = makePluginRoot();
  try {
    for (const payload of RECORDED_CLAUDE_PAYLOADS) {
      const withoutFlag = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH], payload);
      const withFlag = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'claude'], payload);

      assert.equal(withFlag.status, withoutFlag.status);
      assert.equal(withFlag.stdout, withoutFlag.stdout);
      assert.equal(withFlag.stderr, withoutFlag.stderr);
    }
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

// --- codex ---

test('codex: Bash allow passes through with no block', () => {
  const pluginRoot = makePluginRoot();
  try {
    const codexPayload = {
      session_id: 'codex-sess-1',
      turn_id: 'turn-1',
      transcript_path: '/tmp/codex-1.jsonl',
      cwd: '/tmp/proj',
      hook_event_name: 'PreToolUse',
      model: 'gpt-test',
      permission_mode: 'bypassPermissions',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      tool_use_id: 'exec-1'
    };

    // --harness placed before the positional args, to prove it is accepted
    // anywhere in argv.
    const result = runRunner(pluginRoot, ['--harness', 'codex', HOOK_ID, REL_SCRIPT_PATH], codexPayload);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('codex: Bash deny renders as a codex hookSpecificOutput deny', () => {
  const pluginRoot = makePluginRoot();
  try {
    const codexPayload = {
      session_id: 'codex-sess-2',
      turn_id: 'turn-2',
      transcript_path: '/tmp/codex-2.jsonl',
      cwd: '/tmp/proj',
      hook_event_name: 'PreToolUse',
      model: 'gpt-test',
      permission_mode: 'bypassPermissions',
      tool_name: 'Bash',
      tool_input: { command: 'echo forbidden' },
      tool_use_id: 'exec-2'
    };

    const result = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'codex'], codexPayload);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, 'no forbidden commands');
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('codex: apply_patch multi-file fan-out — first deny wins', () => {
  const pluginRoot = makePluginRoot();
  try {
    // Section order matters: the deny on BLOCKED.txt comes first, so it must
    // win even though the later sections (a.txt, c.txt) are both allowed.
    const patchText = [
      '*** Begin Patch',
      '*** Update File: BLOCKED.txt',
      '@@',
      '-old',
      '+new',
      '*** Add File: a.txt',
      '+alpha',
      '*** Delete File: c.txt',
      '*** End Patch'
    ].join('\n');

    const codexPayload = {
      session_id: 'codex-sess-3',
      turn_id: 'turn-3',
      transcript_path: '/tmp/codex-3.jsonl',
      cwd: '/tmp/proj',
      hook_event_name: 'PreToolUse',
      model: 'gpt-test',
      permission_mode: 'bypassPermissions',
      tool_name: 'apply_patch',
      tool_input: { command: patchText },
      tool_use_id: 'exec-3'
    };

    const result = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'codex'], codexPayload);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /BLOCKED\.txt/);
    assert.doesNotMatch(parsed.hookSpecificOutput.permissionDecisionReason, /a\.txt|c\.txt/);
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

// --- omp ---

test('omp: tool_call block renders as omp {block, reason}', () => {
  const pluginRoot = makePluginRoot();
  try {
    const ompPayload = {
      event: 'tool_call',
      payload: {
        type: 'tool_call',
        toolName: 'bash',
        toolCallId: 'call-1',
        input: { command: 'echo forbidden' }
      },
      ctx: {
        session_id: 'omp-sess-1',
        session_file: '/tmp/omp-1.jsonl',
        cwd: '/tmp/proj',
        model: 'omp-test'
      }
    };

    const result = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'omp'], ompPayload);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.block, true);
    assert.equal(parsed.reason, 'no forbidden commands');
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('omp: session_stop with no opinion renders as {continue: true}', () => {
  const pluginRoot = makePluginRoot();
  try {
    const ompPayload = {
      event: 'session_stop',
      payload: {
        type: 'session_stop',
        turn_id: 1,
        session_id: 'omp-sess-2',
        session_file: '/tmp/omp-2.jsonl',
        stop_hook_active: false
      },
      ctx: {
        session_id: 'omp-sess-2',
        session_file: '/tmp/omp-2.jsonl',
        cwd: '/tmp/proj',
        model: 'omp-test'
      }
    };

    const result = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'omp'], ompPayload);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.continue, true);
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});
