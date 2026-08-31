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
//
// It also covers the two non-deny answers a hook can give and the bridge has
// to forward: an explicit `permissionDecision: 'allow'` (auto-approve —
// "PREAPPROVED" in the command, "ALLOWED" in the path) and plain, non-JSON
// stdout on SessionStart, which Claude adds to the model's context verbatim.
const FIXTURE_HOOK_SOURCE = `'use strict';

function verdict(payload, decision, reason) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: payload.hook_event_name,
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    }),
    exitCode: 0
  };
}

function run(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {};
  }

  if (payload.hook_event_name === 'SessionStart' || payload.hook_event_name === 'PreCompact') {
    return { stdout: 'deploy freeze is on until Friday', exitCode: 0 };
  }

  const toolName = payload.tool_name;
  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};

  if (toolName === 'Bash') {
    const command = String(input.command || '');
    if (command.includes('forbidden')) {
      return { exitCode: 2, stderr: 'no forbidden commands' };
    }
    if (command.includes('PREAPPROVED')) {
      return verdict(payload, 'allow', 'on the always-allow list');
    }
    return {};
  }

  if (toolName === 'Write' || toolName === 'Edit') {
    const target = String(input.file_path || '');
    if (target.includes('BLOCKED')) {
      return verdict(payload, 'deny', 'blocked file: ' + target);
    }
    if (target.includes('ALLOWED')) {
      return verdict(payload, 'allow', 'always-allow file: ' + target);
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

// A single (non-fanned-out) payload is emitted exactly as T2 rendered it, the
// same as run-bash-hook.js does — so an `exit 2` + stderr deny stays an
// `exit 2` + stderr deny, which is codex's other native block contract. Only
// the fan-out case (below) has several verdicts to merge, and merging is what
// re-encodes them as one hookSpecificOutput JSON deny.
test('codex: Bash deny keeps the hook\'s own exit-2 + stderr rendering', () => {
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

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /no forbidden commands/);
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

// --- explicit non-blocking verdicts and plain-text stdout survive the bridge ---

function preToolUsePayload(overrides) {
  return Object.assign(
    {
      session_id: 'codex-sess-allow',
      turn_id: 'turn-allow',
      transcript_path: '/tmp/codex-allow.jsonl',
      cwd: '/tmp/proj',
      hook_event_name: 'PreToolUse',
      model: 'gpt-test',
      permission_mode: 'bypassPermissions',
      tool_use_id: 'exec-allow'
    },
    overrides
  );
}

test('codex: an explicit allow is forwarded, not degraded to "no opinion"', () => {
  const pluginRoot = makePluginRoot();
  try {
    const result = runRunner(
      pluginRoot,
      [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'codex'],
      preToolUsePayload({ tool_name: 'Bash', tool_input: { command: 'echo PREAPPROVED' } })
    );

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, 'on the always-allow list');
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('codex: an allow survives the apply_patch fan-out combine', () => {
  const pluginRoot = makePluginRoot();
  try {
    // Two files, both explicitly allowed: the combined verdict is still an
    // allow, and it has to reach the wire.
    const patchText = [
      '*** Begin Patch',
      '*** Update File: ALLOWED-one.txt',
      '@@',
      '-old',
      '+new',
      '*** Update File: ALLOWED-two.txt',
      '@@',
      '-old',
      '+new',
      '*** End Patch'
    ].join('\n');

    const result = runRunner(
      pluginRoot,
      [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'codex'],
      preToolUsePayload({ tool_name: 'apply_patch', tool_input: { command: patchText } })
    );

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /always-allow file/);
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('codex: SessionStart plain-text stdout reaches the wire unchanged', () => {
  const pluginRoot = makePluginRoot();
  try {
    const result = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'codex'], {
      session_id: 'codex-sess-start',
      transcript_path: '/tmp/codex-start.jsonl',
      cwd: '/tmp/proj',
      hook_event_name: 'SessionStart',
      model: 'gpt-test',
      permission_mode: 'bypassPermissions',
      source: 'startup'
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'deploy freeze is on until Friday');
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('omp: plain-text stdout becomes the session_before_compact summary', () => {
  const pluginRoot = makePluginRoot();
  try {
    const result = runRunner(pluginRoot, [HOOK_ID, REL_SCRIPT_PATH, '--harness', 'omp'], {
      event: 'session_before_compact',
      payload: { type: 'session_before_compact', preparation: 'x' },
      ctx: {
        session_id: 'omp-sess-3',
        session_file: '/tmp/omp-3.jsonl',
        cwd: '/tmp/proj',
        model: 'omp-test'
      }
    });

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { summary: 'deploy freeze is on until Friday' });
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});
