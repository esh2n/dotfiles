'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { translateResponse, combineDecisions } = require('../response.js');

test('exit 2 + stderr reason blocks on codex (PreToolUse deny)', () => {
  const result = translateResponse(
    { stdout: '', exitCode: 2, stderr: 'no touching prod files', event: 'PreToolUse' },
    'codex'
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'no touching prod files');
  assert.equal(result.decision.blocked, true);
  assert.equal(result.decision.reason, 'no touching prod files');
});

test('exit 2 with empty stderr falls back to "blocked by hook <id>"', () => {
  const result = translateResponse(
    { stdout: '', exitCode: 2, stderr: '', event: 'PreToolUse' },
    'codex'
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, 'blocked by hook PreToolUse');
  assert.equal(result.decision.reason, 'blocked by hook PreToolUse');
});

test('exit 2 with whitespace-only stderr also falls back to the default reason', () => {
  const result = translateResponse(
    { stdout: '', exitCode: 2, stderr: '   ', event: 'Stop' },
    'omp'
  );

  assert.equal(result.decision.reason, 'blocked by hook Stop');
  assert.deepEqual(JSON.parse(result.stdout), { decision: 'block', reason: 'blocked by hook Stop' });
});

test('malformed JSON stdout is treated as plain text, never as a decision', () => {
  const result = translateResponse(
    { stdout: '{not valid json', exitCode: 0, stderr: '', event: 'PreToolUse' },
    'codex'
  );

  assert.equal(result.decision.blocked, false);
  assert.equal(result.decision.permissionDecision, undefined);
  assert.equal(result.decision.additionalContext, undefined);
  // Non-Stop events pass the original stdout through untouched.
  assert.equal(result.stdout, '{not valid json');
  assert.equal(result.exitCode, 0);
});

test('malformed JSON stdout on omp tool_call yields no block and no input', () => {
  const result = translateResponse(
    { stdout: 'plain text, not json', exitCode: 0, stderr: '', event: 'PreToolUse' },
    'omp'
  );

  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.equal(result.decision.blocked, false);
});

test('PreToolUse permissionDecision deny renders as JSON on codex (no exit-2 needed)', () => {
  const input = {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'secrets file',
      },
    }),
    exitCode: 0,
    stderr: '',
    event: 'PreToolUse',
  };

  const result = translateResponse(input, 'codex');
  const payload = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(payload.hookSpecificOutput.permissionDecisionReason, 'secrets file');
  assert.equal(result.decision.blocked, true);
});

test('PreToolUse permissionDecision allow passes through identical keys on codex', () => {
  const input = {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    }),
    exitCode: 0,
    stderr: '',
    event: 'PreToolUse',
  };

  const result = translateResponse(input, 'codex');
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(result.decision.blocked, false);
});

test('PreToolUse permissionDecision ask maps to deny with prefixed reason on codex', () => {
  const input = {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'unsure about this rm',
      },
    }),
    exitCode: 0,
    stderr: '',
    event: 'PreToolUse',
  };

  const result = translateResponse(input, 'codex');
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(
    payload.hookSpecificOutput.permissionDecisionReason,
    '[ask→deny on codex] unsure about this rm'
  );
  assert.equal(result.decision.blocked, true);
  assert.equal(result.decision.permissionDecision, 'deny');
});

test('permissionDecision ask with no reason still collapses cleanly on codex', () => {
  const input = {
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }),
    exitCode: 0,
    stderr: '',
    event: 'PreToolUse',
  };

  const result = translateResponse(input, 'codex');
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.hookSpecificOutput.permissionDecisionReason, '[ask→deny on codex]');
});

test('PreToolUse permissionDecision ask maps to deny with block:true on omp', () => {
  const input = {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'unsure',
      },
    }),
    exitCode: 0,
    stderr: '',
    event: 'PreToolUse',
  };

  const result = translateResponse(input, 'omp');
  const payload = JSON.parse(result.stdout);

  assert.deepEqual(payload, { block: true, reason: '[ask→deny on omp] unsure' });
});

test('PreToolUse updatedInput without a block becomes {input} on omp tool_call', () => {
  const input = {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { command: 'ls -la' },
      },
    }),
    exitCode: 0,
    stderr: '',
    event: 'PreToolUse',
  };

  const result = translateResponse(input, 'omp');
  const payload = JSON.parse(result.stdout);

  assert.deepEqual(payload, { input: { command: 'ls -la' } });
});

test('Stop decision:block renders identically on codex and as session_stop on omp', () => {
  const input = {
    stdout: JSON.stringify({ decision: 'block', reason: 'unsaved work' }),
    exitCode: 0,
    stderr: '',
    event: 'Stop',
  };

  const codex = translateResponse(input, 'codex');
  assert.deepEqual(JSON.parse(codex.stdout), { decision: 'block', reason: 'unsaved work' });

  const omp = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(omp.stdout), { decision: 'block', reason: 'unsaved work' });
});

test('old-style Stop {continue:false, stopReason} blocks the same way', () => {
  const input = {
    stdout: JSON.stringify({ continue: false, stopReason: 'still running tests' }),
    exitCode: 0,
    stderr: '',
    event: 'SubagentStop',
  };

  const omp = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(omp.stdout), { decision: 'block', reason: 'still running tests' });
});

test('Stop with an empty JSON payload is a no-op: {} on codex, {continue:true} on omp', () => {
  const input = { stdout: '{}', exitCode: 0, stderr: '', event: 'Stop' };

  const codex = translateResponse(input, 'codex');
  assert.equal(codex.stdout, '');
  assert.equal(codex.exitCode, 0);

  const omp = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(omp.stdout), { continue: true });
});

test('Stop/SubagentStop stdout is stripped to empty JSON-only output when the hook printed plain text', () => {
  const input = { stdout: 'all good, nothing to see', exitCode: 0, stderr: '', event: 'SubagentStop' };

  const result = translateResponse(input, 'codex');

  assert.equal(result.stdout, '');
  assert.equal(result.exitCode, 0);
});

test('SessionStart/UserPromptSubmit additionalContext renders as hookSpecificOutput on codex', () => {
  const input = {
    stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'repo uses pnpm' } }),
    exitCode: 0,
    stderr: '',
    event: 'SessionStart',
  };

  const result = translateResponse(input, 'codex');
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(payload.hookSpecificOutput.additionalContext, 'repo uses pnpm');
});

test('UserPromptSubmit additionalContext becomes a user message on omp (before_agent_start)', () => {
  const input = {
    stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'remember: no force push' } }),
    exitCode: 0,
    stderr: '',
    event: 'UserPromptSubmit',
  };

  const result = translateResponse(input, 'omp');
  const payload = JSON.parse(result.stdout);

  assert.deepEqual(payload, { message: { role: 'user', content: 'remember: no force push' } });
});

test('SessionStart with no additionalContext is a no-op on omp', () => {
  const result = translateResponse({ stdout: '{}', exitCode: 0, stderr: '', event: 'SessionStart' }, 'omp');
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test('PostToolUse decision:block becomes {content, isError:true} on omp tool_result', () => {
  const input = {
    stdout: JSON.stringify({ decision: 'block', reason: 'bad diff' }),
    exitCode: 0,
    stderr: '',
    event: 'PostToolUse',
  };

  const result = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(result.stdout), { content: 'bad diff', isError: true });
});

test('PostToolUse additionalContext without a block becomes {content} on omp tool_result', () => {
  const input = {
    stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'ran lint, 0 issues' } }),
    exitCode: 0,
    stderr: '',
    event: 'PostToolUse',
  };

  const result = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(result.stdout), { content: 'ran lint, 0 issues' });
});

test('PreCompact plain-text summary becomes {summary} on omp session_before_compact', () => {
  const input = { stdout: 'compacted: dropped 40 old tool results', exitCode: 0, stderr: '', event: 'PreCompact' };

  const result = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(result.stdout), { summary: 'compacted: dropped 40 old tool results' });
});

test('PreCompact stdout JSON {summary} (T18: pre-compact.js on omp) passes straight through', () => {
  const input = { stdout: JSON.stringify({ summary: 'compaction summary from pre-compact.js' }), exitCode: 0, stderr: '', event: 'PreCompact' };

  const result = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(result.stdout), { summary: 'compaction summary from pre-compact.js' });
});

test('PreCompact {summary} JSON outranks additionalContext/plainText/systemMessage when somehow all are present', () => {
  const input = {
    stdout: JSON.stringify({ summary: 'the real summary', systemMessage: 'a decoy' }),
    exitCode: 0,
    stderr: '',
    event: 'PreCompact',
  };

  const result = translateResponse(input, 'omp');
  assert.deepEqual(JSON.parse(result.stdout), { summary: 'the real summary' });
});

test('PreCompact plain text is passed through unchanged on codex (not a Stop-family event)', () => {
  const input = { stdout: 'compacted: dropped 40 old tool results', exitCode: 0, stderr: '', event: 'PreCompact' };

  const result = translateResponse(input, 'codex');
  assert.equal(result.stdout, 'compacted: dropped 40 old tool results');
});

test('systemMessage and suppressOutput ride along standalone on codex', () => {
  const input = {
    stdout: JSON.stringify({ systemMessage: 'heads up: slow tool', suppressOutput: true }),
    exitCode: 0,
    stderr: '',
    event: 'PreToolUse',
  };

  const result = translateResponse(input, 'codex');
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.systemMessage, 'heads up: slow tool');
  assert.equal(payload.suppressOutput, true);
  assert.equal(result.decision.systemMessage, 'heads up: slow tool');
  assert.equal(result.decision.suppressOutput, true);
});

test('unrecognized event falls back to a generic omp payload instead of dropping the block', () => {
  const result = translateResponse(
    { stdout: '', exitCode: 2, stderr: 'unknown lifecycle stage', event: 'SomeFutureEvent' },
    'omp'
  );

  assert.deepEqual(JSON.parse(result.stdout), { block: true, reason: 'unknown lifecycle stage' });
});

test('no/unknown harness passes the Claude-shaped response through untouched', () => {
  const input = { stdout: 'raw text', exitCode: 0, stderr: '', event: 'PreToolUse' };

  const result = translateResponse(input, undefined);

  assert.equal(result.stdout, 'raw text');
  assert.equal(result.exitCode, 0);
  assert.equal(result.decision.blocked, false);
});

test('combineDecisions: first deny wins, additionalContext concatenated in order', () => {
  const combined = combineDecisions([
    { blocked: false, additionalContext: 'hook A ran' },
    { blocked: true, reason: 'hook B says no', permissionDecision: 'deny' },
    { blocked: true, reason: 'hook C also says no', permissionDecision: 'deny' },
    { blocked: false, additionalContext: 'hook D ran' },
  ]);

  assert.equal(combined.blocked, true);
  assert.equal(combined.reason, 'hook B says no');
  assert.equal(combined.permissionDecision, 'deny');
  assert.equal(combined.additionalContext, 'hook A ran\nhook D ran');
});

test('combineDecisions: no blocking entries leaves blocked false and reason undefined', () => {
  const combined = combineDecisions([
    { blocked: false, additionalContext: 'ctx1' },
    { blocked: false, additionalContext: 'ctx2' },
  ]);

  assert.equal(combined.blocked, false);
  assert.equal(combined.reason, undefined);
  assert.equal(combined.additionalContext, 'ctx1\nctx2');
});

test('combineDecisions: empty list returns an unblocked no-op decision', () => {
  const combined = combineDecisions([]);

  assert.equal(combined.blocked, false);
  assert.equal(combined.additionalContext, undefined);
  assert.equal(combined.permissionDecision, undefined);
});

test('combineDecisions: ignores null/non-object entries defensively', () => {
  const combined = combineDecisions([null, undefined, { blocked: true, reason: 'x' }, 'not-an-object']);

  assert.equal(combined.blocked, true);
  assert.equal(combined.reason, 'x');
});

// --- non-blocking verdicts survive the combine. `permissionDecision: 'allow'`
// is a real Claude hook verdict (auto-approve), and it used to be read only
// off blocking decisions, so an allowing hook was silently downgraded to
// "no opinion" everywhere the combine round-trip runs. ---

test('combineDecisions: an explicit non-blocking allow is carried, not dropped', () => {
  const combined = combineDecisions([
    { blocked: false, permissionDecision: 'allow', reason: 'pre-approved by policy' },
    { blocked: false, additionalContext: 'hook B ran' },
  ]);

  assert.equal(combined.blocked, false);
  assert.equal(combined.permissionDecision, 'allow');
  assert.equal(combined.reason, 'pre-approved by policy');
  assert.equal(combined.additionalContext, 'hook B ran');
});

test('combineDecisions: ask outranks allow among non-blocking verdicts', () => {
  const combined = combineDecisions([
    { blocked: false, permissionDecision: 'allow', reason: 'fine by me' },
    { blocked: false, permissionDecision: 'ask', reason: 'check with the human' },
    { blocked: false, permissionDecision: 'allow', reason: 'also fine' },
  ]);

  assert.equal(combined.blocked, false);
  assert.equal(combined.permissionDecision, 'ask');
  assert.equal(combined.reason, 'check with the human');
});

test('combineDecisions: a deny still beats any non-blocking allow', () => {
  const combined = combineDecisions([
    { blocked: false, permissionDecision: 'allow', reason: 'fine by me' },
    { blocked: true, permissionDecision: 'deny', reason: 'absolutely not' },
  ]);

  assert.equal(combined.blocked, true);
  assert.equal(combined.permissionDecision, 'deny');
  assert.equal(combined.reason, 'absolutely not');
});

test('translateResponse: a non-blocking allow reaches the canonical decision', () => {
  const stdout = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'ok' },
  });
  const result = translateResponse({ stdout, exitCode: 0, stderr: '', event: 'PreToolUse' }, 'codex');

  assert.equal(result.decision.blocked, false);
  assert.equal(result.decision.permissionDecision, 'allow');
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'allow');
});

// --- an input rewrite with no verdict attached is still a rewrite ---

test('codex: updatedInput is rendered even with no verdict, only context, beside it', () => {
  const stdout = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: 'rewrote the command',
      updatedInput: { command: 'echo safe' },
    },
  });
  const result = translateResponse({ stdout, exitCode: 0, stderr: '', event: 'PreToolUse' }, 'codex');
  const hso = JSON.parse(result.stdout).hookSpecificOutput;

  assert.equal(hso.additionalContext, 'rewrote the command');
  assert.deepEqual(hso.updatedInput, { command: 'echo safe' });
  assert.deepEqual(result.decision.updatedInput, { command: 'echo safe' });
});

test('combineDecisions: updatedInput survives alongside a plain context entry', () => {
  const combined = combineDecisions([
    { blocked: false, additionalContext: 'note' },
    { blocked: false, updatedInput: { command: 'echo safe' } },
  ]);

  assert.deepEqual(combined.updatedInput, { command: 'echo safe' });
});

// --- plain-text stdout survives into the canonical decision, so a caller that
// combines and re-renders (run-with-flags.js) can still get it back ---

test("the canonical decision carries a hook's plain-text stdout", () => {
  const result = translateResponse(
    { stdout: 'remember: the deploy freeze is on', exitCode: 0, stderr: '', event: 'SessionStart' },
    'codex'
  );

  assert.equal(result.decision.plainText, 'remember: the deploy freeze is on');
  assert.equal(result.stdout, 'remember: the deploy freeze is on');
});

test('combineDecisions: plain-text stdout is concatenated in order', () => {
  const combined = combineDecisions([
    { blocked: false, plainText: 'first note' },
    { blocked: false },
    { blocked: false, plainText: 'second note' },
  ]);

  assert.equal(combined.plainText, 'first note\nsecond note');
});
