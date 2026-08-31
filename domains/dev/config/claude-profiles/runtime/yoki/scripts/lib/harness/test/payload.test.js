'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizePayload } = require('../payload');

function fixture(harness, name) {
  const file = path.join(__dirname, 'fixtures', harness, `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// claude: identity
// ---------------------------------------------------------------------------

test('claude harness returns the input unchanged', () => {
  const raw = { session_id: 'x', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } };
  const { payload, meta } = normalizePayload(raw, 'claude');
  assert.equal(payload, raw);
  assert.equal(meta.harness, 'claude');
});

// ---------------------------------------------------------------------------
// codex: fields that already match Claude's shape
// ---------------------------------------------------------------------------

test('codex SessionStart passes through unchanged', () => {
  const raw = fixture('codex', 'session_start');
  const { payload } = normalizePayload(raw, 'codex');
  assert.deepEqual(payload, raw);
});

test('codex UserPromptSubmit passes through unchanged', () => {
  const raw = fixture('codex', 'user_prompt_submit');
  const { payload } = normalizePayload(raw, 'codex');
  assert.deepEqual(payload, raw);
});

test('codex Stop passes through unchanged', () => {
  const raw = fixture('codex', 'stop');
  const { payload } = normalizePayload(raw, 'codex');
  assert.deepEqual(payload, raw);
  assert.equal(payload.stop_hook_active, false);
});

test('codex Stop with stop_hook_active=true passes through unchanged', () => {
  const raw = fixture('codex', 'stop_active');
  const { payload } = normalizePayload(raw, 'codex');
  assert.deepEqual(payload, raw);
  assert.equal(payload.stop_hook_active, true);
});

test('codex SessionEnd passes through unchanged', () => {
  const raw = fixture('codex', 'session_end');
  const { payload } = normalizePayload(raw, 'codex');
  assert.deepEqual(payload, raw);
});

test('codex SubagentStart passes through unchanged', () => {
  const raw = fixture('codex', 'subagent_start');
  const { payload } = normalizePayload(raw, 'codex');
  assert.deepEqual(payload, raw);
});

test('codex SubagentStop maps agent_transcript_path onto transcript_path', () => {
  const raw = fixture('codex', 'subagent_stop');
  const { payload } = normalizePayload(raw, 'codex');
  assert.equal(payload.transcript_path, raw.agent_transcript_path);
  assert.equal(payload.agent_transcript_path, undefined);
  assert.equal(payload.session_id, raw.session_id);
  assert.equal(payload.last_assistant_message, 'pong');
});

// ---------------------------------------------------------------------------
// codex: tool_name mapping
// ---------------------------------------------------------------------------

test('codex Bash PreToolUse/PostToolUse stay Bash', () => {
  const pre = fixture('codex', 'pre_tool_use_bash');
  const post = fixture('codex', 'post_tool_use_bash');

  const preOut = normalizePayload(pre, 'codex').payload;
  const postOut = normalizePayload(post, 'codex').payload;

  assert.equal(preOut.tool_name, 'Bash');
  assert.equal(preOut.tool_input.command, 'echo hi');
  assert.equal(postOut.tool_name, 'Bash');
  assert.equal(postOut.tool_response, 'hi\n');
});

test('codex apply_patch Add File becomes a single Write payload', () => {
  const raw = fixture('codex', 'pre_tool_use_apply_patch_add');
  const { payload, meta } = normalizePayload(raw, 'codex');

  assert.equal(meta.payloads, undefined);
  assert.equal(payload.tool_name, 'Write');
  assert.equal(payload.tool_input.file_path, path.join(raw.cwd, 'a.txt'));
  assert.equal(payload.tool_input.content, 'alpha');
  // Non-tool fields carried through unchanged.
  assert.equal(payload.session_id, raw.session_id);
  assert.equal(payload.hook_event_name, 'PreToolUse');
});

test('codex apply_patch Add File PostToolUse keeps tool_response', () => {
  const raw = fixture('codex', 'post_tool_use_apply_patch_add');
  const { payload } = normalizePayload(raw, 'codex');

  assert.equal(payload.tool_name, 'Write');
  assert.equal(payload.tool_input.file_path, path.join(raw.cwd, 'a.txt'));
  assert.equal(payload.tool_input.content, 'alpha');
  assert.equal(payload.tool_response, raw.tool_response);
});

test('codex apply_patch Update File becomes a single Edit payload', () => {
  const raw = fixture('codex', 'pre_tool_use_apply_patch_update');
  const { payload, meta } = normalizePayload(raw, 'codex');

  assert.equal(meta.payloads, undefined);
  assert.equal(payload.tool_name, 'Edit');
  assert.equal(payload.tool_input.file_path, path.join(raw.cwd, 'a.txt'));
  assert.equal(payload.tool_input.content, undefined);
});

test('codex apply_patch Update File PostToolUse keeps tool_response', () => {
  const raw = fixture('codex', 'post_tool_use_apply_patch_update');
  const { payload } = normalizePayload(raw, 'codex');

  assert.equal(payload.tool_name, 'Edit');
  assert.equal(payload.tool_input.file_path, path.join(raw.cwd, 'a.txt'));
  assert.equal(payload.tool_response, raw.tool_response);
});

test('codex apply_patch Delete File becomes a Bash rm payload', () => {
  const raw = fixture('codex', 'pre_tool_use_apply_patch_update');
  const deleteRaw = Object.assign({}, raw, {
    tool_input: { command: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch' },
  });
  const { payload } = normalizePayload(deleteRaw, 'codex');

  assert.equal(payload.tool_name, 'Bash');
  assert.equal(payload.tool_input.command, `rm ${path.join(raw.cwd, 'a.txt')}`);
});

test('codex apply_patch touching several files fans out via meta.payloads', () => {
  const raw = fixture('codex', 'pre_tool_use_apply_patch_add');
  const multiRaw = Object.assign({}, raw, {
    tool_input: {
      command:
        '*** Begin Patch\n*** Add File: a.txt\n+alpha\n*** Update File: b.txt\n@@\n-x\n+y\n*** Delete File: c.txt\n*** End Patch',
    },
  });
  const { payload, meta } = normalizePayload(multiRaw, 'codex');

  assert.equal(payload, null);
  assert.equal(meta.payloads.length, 3);

  const [addPayload, updatePayload, deletePayload] = meta.payloads;
  assert.equal(addPayload.tool_name, 'Write');
  assert.equal(addPayload.tool_input.file_path, path.join(raw.cwd, 'a.txt'));
  assert.equal(addPayload.tool_input.content, 'alpha');

  assert.equal(updatePayload.tool_name, 'Edit');
  assert.equal(updatePayload.tool_input.file_path, path.join(raw.cwd, 'b.txt'));

  assert.equal(deletePayload.tool_name, 'Bash');
  assert.equal(deletePayload.tool_input.command, `rm ${path.join(raw.cwd, 'c.txt')}`);

  // Every fanned-out payload still carries the shared envelope fields.
  for (const p of meta.payloads) {
    assert.equal(p.session_id, raw.session_id);
    assert.equal(p.hook_event_name, 'PreToolUse');
  }
});

test('codex apply_patch with an absolute path is not re-resolved', () => {
  const raw = fixture('codex', 'pre_tool_use_apply_patch_update');
  const absRaw = Object.assign({}, raw, {
    tool_input: { command: '*** Begin Patch\n*** Update File: /abs/a.txt\n@@\n-alpha\n+beta\n*** End Patch' },
  });
  const { payload } = normalizePayload(absRaw, 'codex');
  assert.equal(payload.tool_input.file_path, '/abs/a.txt');
});

test('codex spawn_agent (collaborationspawn_agent) maps tool_name to Task', () => {
  const pre = fixture('codex', 'pre_tool_use_spawn_agent');
  const post = fixture('codex', 'post_tool_use_spawn_agent');

  const preOut = normalizePayload(pre, 'codex').payload;
  const postOut = normalizePayload(post, 'codex').payload;

  assert.equal(preOut.tool_name, 'Task');
  assert.deepEqual(preOut.tool_input, pre.tool_input);
  assert.equal(postOut.tool_name, 'Task');
  assert.equal(postOut.tool_response, post.tool_response);
});

test('codex spawn_agent bare alias also maps to Task', () => {
  const pre = fixture('codex', 'pre_tool_use_spawn_agent');
  const aliased = Object.assign({}, pre, { tool_name: 'spawn_agent' });
  const { payload } = normalizePayload(aliased, 'codex');
  assert.equal(payload.tool_name, 'Task');
});

test('codex wait_agent (collaborationwait_agent) passes through unchanged', () => {
  const pre = fixture('codex', 'pre_tool_use_wait_agent');
  const post = fixture('codex', 'post_tool_use_wait_agent');

  const preOut = normalizePayload(pre, 'codex').payload;
  const postOut = normalizePayload(post, 'codex').payload;

  assert.equal(preOut.tool_name, 'collaborationwait_agent');
  assert.deepEqual(preOut.tool_input, pre.tool_input);
  assert.equal(postOut.tool_name, 'collaborationwait_agent');
  assert.equal(postOut.tool_response, post.tool_response);
});

test('codex wait_agent bare alias also passes through unchanged', () => {
  const pre = fixture('codex', 'pre_tool_use_wait_agent');
  const aliased = Object.assign({}, pre, { tool_name: 'wait_agent' });
  const { payload } = normalizePayload(aliased, 'codex');
  assert.equal(payload.tool_name, 'wait_agent');
});

// ---------------------------------------------------------------------------
// omp: event mapping
// ---------------------------------------------------------------------------

test('omp session_start maps to SessionStart', () => {
  const raw = fixture('omp', 'session_start');
  const { payload } = normalizePayload(raw, 'omp');

  assert.equal(payload.hook_event_name, 'SessionStart');
  assert.equal(payload.session_id, raw.ctx.session_id);
  assert.equal(payload.cwd, raw.ctx.cwd);
  assert.equal(payload.transcript_path, raw.ctx.session_file);
  assert.equal(payload.model, raw.ctx.model);
});

test('omp before_agent_start maps to UserPromptSubmit with prompt', () => {
  const raw = fixture('omp', 'before_agent_start');
  const { payload } = normalizePayload(raw, 'omp');

  assert.equal(payload.hook_event_name, 'UserPromptSubmit');
  assert.equal(payload.prompt, raw.payload.prompt);
  assert.equal(payload.transcript_path, raw.ctx.session_file);
});

test('omp tool_call bash maps to PreToolUse/Bash', () => {
  const raw = fixture('omp', 'tool_call_bash');
  const { payload, meta } = normalizePayload(raw, 'omp');

  assert.equal(meta.payloads, undefined);
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'Bash');
  assert.equal(payload.tool_input.command, 'echo hi');
});

test('omp tool_result bash maps to PostToolUse/Bash with tool_response', () => {
  const raw = fixture('omp', 'tool_result_bash');
  const { payload } = normalizePayload(raw, 'omp');

  assert.equal(payload.hook_event_name, 'PostToolUse');
  assert.equal(payload.tool_name, 'Bash');
  assert.deepEqual(payload.tool_response, raw.payload.content);
  assert.equal(payload.isError, false);
});

test('omp tool_call write maps to PreToolUse/Write with file_path+content', () => {
  const raw = fixture('omp', 'tool_call_write');
  const { payload } = normalizePayload(raw, 'omp');

  assert.equal(payload.tool_name, 'Write');
  assert.equal(payload.tool_input.file_path, 'probe2.txt');
  assert.equal(payload.tool_input.content, 'hello\n');
});

test('omp tool_call edit with a single-path hashline patch yields one Edit payload', () => {
  const raw = fixture('omp', 'tool_call_edit_hashline');
  // Narrow the fixture to a single path for this case.
  const singlePath = Object.assign({}, raw, {
    payload: Object.assign({}, raw.payload, { input: { input: '[a.txt#1a2b]\nsome content\n' } }),
  });
  const { payload, meta } = normalizePayload(singlePath, 'omp');

  assert.equal(meta.payloads, undefined);
  assert.equal(payload.tool_name, 'Edit');
  assert.equal(payload.tool_input.file_path, 'a.txt');
});

test('omp tool_call edit with a multi-path hashline patch fans out via meta.payloads', () => {
  const raw = fixture('omp', 'tool_call_edit_hashline');
  const { payload, meta } = normalizePayload(raw, 'omp');

  assert.equal(payload, null);
  assert.equal(meta.payloads.length, 2);
  assert.equal(meta.payloads[0].tool_name, 'Edit');
  assert.equal(meta.payloads[0].tool_input.file_path, 'a.txt');
  assert.equal(meta.payloads[1].tool_input.file_path, 'b.txt');
});

test('omp tool_call apply_patch envelope reuses editPaths and maps to Edit', () => {
  const raw = fixture('omp', 'tool_call_apply_patch');
  const { payload, meta } = normalizePayload(raw, 'omp');

  assert.equal(meta.payloads, undefined);
  assert.equal(payload.tool_name, 'Edit');
  assert.equal(payload.tool_input.file_path, 'a.txt');
});

test('omp tool_call read/glob/grep/ls map tool_name only, input passthrough', () => {
  const cases = [
    ['tool_call_read', 'Read'],
    ['tool_call_glob', 'Glob'],
    ['tool_call_grep', 'Grep'],
    ['tool_call_ls', 'LS'],
  ];
  for (const [fixtureName, expectedToolName] of cases) {
    const raw = fixture('omp', fixtureName);
    const { payload } = normalizePayload(raw, 'omp');
    assert.equal(payload.tool_name, expectedToolName, fixtureName);
    assert.deepEqual(payload.tool_input, raw.payload.input, fixtureName);
  }
});

test('omp tool_call task maps to Task', () => {
  const raw = fixture('omp', 'tool_call_task');
  const { payload } = normalizePayload(raw, 'omp');
  assert.equal(payload.tool_name, 'Task');
  assert.deepEqual(payload.tool_input, raw.payload.input);
});

test('omp tool_call for an unmapped tool name passes tool_name through unchanged', () => {
  const raw = fixture('omp', 'tool_call_other');
  const { payload } = normalizePayload(raw, 'omp');
  assert.equal(payload.tool_name, 'websearch');
  assert.deepEqual(payload.tool_input, raw.payload.input);
});

test('omp session_before_compact maps to PreCompact', () => {
  const raw = fixture('omp', 'session_before_compact');
  const { payload } = normalizePayload(raw, 'omp');
  assert.equal(payload.hook_event_name, 'PreCompact');
  assert.deepEqual(payload.branchEntries, raw.payload.branchEntries);
});

test('omp session_stop maps to Stop', () => {
  const raw = fixture('omp', 'session_stop');
  const { payload } = normalizePayload(raw, 'omp');
  assert.equal(payload.hook_event_name, 'Stop');
  assert.equal(payload.stop_hook_active, false);
  assert.equal(payload.turn_id, raw.payload.turn_id);
  assert.equal(payload.transcript_path, raw.ctx.session_file);
});

test('omp session_stop with stop_hook_active=true (continuation) maps to Stop', () => {
  const raw = fixture('omp', 'session_stop_active');
  const { payload } = normalizePayload(raw, 'omp');
  assert.equal(payload.hook_event_name, 'Stop');
  assert.equal(payload.stop_hook_active, true);
});

test('omp session_shutdown maps to SessionEnd', () => {
  const raw = fixture('omp', 'session_shutdown');
  const { payload } = normalizePayload(raw, 'omp');
  assert.equal(payload.hook_event_name, 'SessionEnd');
});

test('omp tool_approval_requested maps to Notification(permission_prompt)', () => {
  const raw = fixture('omp', 'tool_approval_requested');
  const { payload } = normalizePayload(raw, 'omp');
  assert.equal(payload.hook_event_name, 'Notification');
  assert.equal(payload.notification_type, 'permission_prompt');
  assert.equal(payload.tool_name, raw.payload.toolName);
  assert.equal(payload.reason, raw.payload.reason);
});

// ---------------------------------------------------------------------------
// input validation at the boundary
// ---------------------------------------------------------------------------

test('normalizePayload throws on an unknown harness', () => {
  assert.throws(() => normalizePayload({}, 'unknown'), /unknown harness/);
});

test('normalizePayload tolerates a non-object raw payload for codex/omp', () => {
  assert.deepEqual(normalizePayload(null, 'codex'), { payload: null, meta: { harness: 'codex' } });
  assert.deepEqual(normalizePayload(null, 'omp'), { payload: null, meta: { harness: 'omp' } });
});
