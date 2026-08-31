'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeHandlerHash,
  canonicalJson,
  normalizeHandler,
  hookStateKey,
  eventLabelFor,
} = require('../codex-trust');

// Ground truth from scratchpad spike S1+S2 Appendix C — the existing herdr
// entry in ~/.codex/config.toml, read (never modified) during the spike:
//
//   [hooks.state."/Users/esh2n/.codex/hooks.json:session_start:0:0"]
//   trusted_hash = "sha256:34637d171b45f4595a9a8f510e6091670f0e98e4f14c6581b6a4fd947cc49cd5"
//
// reproduced by the spike's trusthash.py from the exact input:
//   {"event_name":"session_start","hooks":[{"async":false,
//    "command":"bash '/Users/esh2n/.codex/herdr-agent-state.sh' session",
//    "timeout":10,"type":"command"}]}
const HERDR_HASH = 'sha256:34637d171b45f4595a9a8f510e6091670f0e98e4f14c6581b6a4fd947cc49cd5';
const HERDR_COMMAND = "bash '/Users/esh2n/.codex/herdr-agent-state.sh' session";
const HERDR_JSON = '{"event_name":"session_start","hooks":[{"async":false,"command":"bash \'/Users/esh2n/.codex/herdr-agent-state.sh\' session","timeout":10,"type":"command"}]}';

test('computeHandlerHash reproduces the herdr session_start hash byte-for-byte', () => {
  const hash = computeHandlerHash({
    eventLabel: 'session_start',
    handler: { command: HERDR_COMMAND, timeout: 10 },
  });
  assert.equal(hash, HERDR_HASH);
});

test('computeHandlerHash accepts the Codex event name too, not just the snake_case label', () => {
  const hash = computeHandlerHash({
    event: 'SessionStart',
    handler: { command: HERDR_COMMAND, timeout: 10 },
  });
  assert.equal(hash, HERDR_HASH);
});

test('canonicalJson matches the exact herdr input text (sorted keys, compact, async included)', () => {
  const json = canonicalJson({
    event_name: 'session_start',
    hooks: [normalizeHandler({ command: HERDR_COMMAND, timeout: 10 }, 'session_start')],
  });
  assert.equal(json, HERDR_JSON);
});

test('normalizeHandler: default timeout is 600 for a normal event, floored at 1', () => {
  const normal = normalizeHandler({ command: 'echo hi' }, 'pre_tool_use');
  assert.equal(normal.timeout, 600);

  const floored = normalizeHandler({ command: 'echo hi', timeout: 0 }, 'pre_tool_use');
  assert.equal(floored.timeout, 1);
});

test('normalizeHandler: SessionEnd defaults to 1s and clamps to [1,3]', () => {
  assert.equal(normalizeHandler({ command: 'echo hi' }, 'session_end').timeout, 1);
  assert.equal(normalizeHandler({ command: 'echo hi', timeout: 30 }, 'session_end').timeout, 3);
  assert.equal(normalizeHandler({ command: 'echo hi', timeout: 0 }, 'session_end').timeout, 1);
});

test('normalizeHandler: additionalContextLimit is dropped at the 2500 default and for events that never carry it', () => {
  const atDefault = normalizeHandler({ command: 'echo hi', additionalContextLimit: 2500 }, 'pre_tool_use');
  assert.ok(!('additionalContextLimit' in atDefault));

  const nonDefault = normalizeHandler({ command: 'echo hi', additionalContextLimit: 500 }, 'pre_tool_use');
  assert.equal(nonDefault.additionalContextLimit, 500);

  const wrongEvent = normalizeHandler({ command: 'echo hi', additionalContextLimit: 500 }, 'stop');
  assert.ok(!('additionalContextLimit' in wrongEvent));
});

test('normalizeHandler: statusMessage is kept only when set', () => {
  assert.ok(!('statusMessage' in normalizeHandler({ command: 'echo hi' }, 'stop')));
  assert.equal(normalizeHandler({ command: 'echo hi', statusMessage: 'Running…' }, 'stop').statusMessage, 'Running…');
});

test('computeHandlerHash changes when the command text changes (Modified, per S1+S2 §2.1)', () => {
  const original = computeHandlerHash({ eventLabel: 'session_start', handler: { command: HERDR_COMMAND, timeout: 10 } });
  const edited = computeHandlerHash({ eventLabel: 'session_start', handler: { command: `${HERDR_COMMAND} extra`, timeout: 10 } });
  assert.notEqual(original, edited);
});

test('computeHandlerHash is unaffected by ${VAR} substitution timing (hash is over literal command text)', () => {
  const literal = computeHandlerHash({ eventLabel: 'pre_tool_use', handler: { command: '"${YOKI_NODE:-node}" run.js', timeout: 5 } });
  const sameLiteralAgain = computeHandlerHash({ eventLabel: 'pre_tool_use', handler: { command: '"${YOKI_NODE:-node}" run.js', timeout: 5 } });
  assert.equal(literal, sameLiteralAgain);
});

test('computeHandlerHash includes the matcher when the group set one', () => {
  const withMatcher = computeHandlerHash({ eventLabel: 'pre_tool_use', matcher: 'Bash', handler: { command: 'echo hi', timeout: 5 } });
  const withoutMatcher = computeHandlerHash({ eventLabel: 'pre_tool_use', handler: { command: 'echo hi', timeout: 5 } });
  assert.notEqual(withMatcher, withoutMatcher);
});

test('hookStateKey formats <key_source>:<event_label>:<group_index>:<handler_index>', () => {
  assert.equal(
    hookStateKey('/Users/esh2n/.codex/hooks.json', 'session_start', 0, 0),
    '/Users/esh2n/.codex/hooks.json:session_start:0:0'
  );
});

test('eventLabelFor maps every Codex event name to its snake_case label', () => {
  assert.equal(eventLabelFor('PreToolUse'), 'pre_tool_use');
  assert.equal(eventLabelFor('SessionEnd'), 'session_end');
  assert.equal(eventLabelFor('SubagentStop'), 'subagent_stop');
});
