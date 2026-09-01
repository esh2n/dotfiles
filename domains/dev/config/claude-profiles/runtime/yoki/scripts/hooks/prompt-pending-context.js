#!/usr/bin/env node
/**
 * UserPromptSubmit hook — drains this session's pending-context queue
 * (../lib/pending-context.js) and surfaces it as additionalContext.
 *
 * The queue exists for hooks that learn something worth telling the model
 * at a point in the harness lifecycle with no direct context-injection
 * channel of its own — Codex's PreCompact (see pre-compact.js, which has no
 * way to inject context on that harness) and artifact-comments.js's own
 * SessionStart/UserPromptSubmit hook, which now enqueues instead of
 * emitting directly so the same delivery path works on every harness. Both
 * `enqueue()` into the same per-(harness, session) file; this hook is the
 * one and only place that ever `drain()`s it, so an item is surfaced
 * exactly once, on the next prompt after it was queued.
 *
 * Session identity is resolved the same way cost-tracker.js and
 * artifact-comments.js do — `input.session_id`, then the
 * YOKI_SESSION_ID/CLAUDE_SESSION_ID env fallbacks, then 'default' — so the
 * file this hook drains is the same one those hooks enqueued into even when
 * a payload happens to omit session_id.
 */

'use strict';

const { drain } = require('../lib/pending-context');

const MAX_STDIN = 1024 * 1024;
const EVENT = 'UserPromptSubmit';

let raw = '';

function resolveHarness() {
  return String(process.env.YOKI_HARNESS || 'claude').trim() || 'claude';
}

function resolveSessionId(input) {
  const fromPayload = input && typeof input.session_id === 'string' ? input.session_id.trim() : '';
  if (fromPayload) return fromPayload;
  const fromEnv = String(process.env.YOKI_SESSION_ID || process.env.CLAUDE_SESSION_ID || '').trim();
  return fromEnv || 'default';
}

function buildOutput(additionalContext) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT, additionalContext } });
}

/** "Nothing queued." Empty stdout + exit 0 — see artifact-comments.js's
 * SILENT for why this is not an echo of the incoming payload. */
const SILENT = Object.freeze({ stdout: '', exitCode: 0 });

function run(rawInput) {
  let input = null;
  try {
    input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  } catch {
    return SILENT;
  }

  const event = String((input && input.hook_event_name) || '');
  if (event !== EVENT) return SILENT;

  const session = { harness: resolveHarness(), sessionId: resolveSessionId(input) };

  let texts;
  try {
    texts = drain(session);
  } catch (err) {
    return { stdout: '', exitCode: 0, stderr: `[Hook] prompt-pending-context: cannot drain queue: ${err.message}` };
  }

  if (!texts || texts.length === 0) return SILENT;

  return { stdout: buildOutput(texts.join('\n\n')), exitCode: 0 };
}

if (require.main === module) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      raw += chunk.substring(0, MAX_STDIN - raw.length);
    }
  });

  process.stdin.on('end', () => {
    const result = run(raw);
    if (result && typeof result === 'object') {
      if (result.stderr) process.stderr.write(`${result.stderr}\n`);
      process.stdout.write(String(result.stdout || ''));
      process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 0;
      return;
    }
    process.stdout.write(String(result));
  });
}

module.exports = { run, resolveHarness, resolveSessionId };
