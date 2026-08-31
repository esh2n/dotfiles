#!/usr/bin/env node
/**
 * Bash hook wrapper: runs a personal `.sh` hook (git-guard, etc.) unmodified
 * under any harness (codex, omp) by sandwiching it between T1 (payload
 * normalization / fan-out) and T2 (response translation).
 *
 * Usage:
 *   node run-bash-hook.js --harness <codex|omp|claude> <hook.sh> [args...]
 *
 * <hook.sh> may be an absolute path or a path relative to ~/.claude (the
 * layout the personal settings layer installs hooks into), matching the
 * `~/.claude/hooks/<name>.sh` references baked into settings.personal.json.
 *
 * Pipeline per invocation:
 *   1. Read the harness-native JSON event on stdin.
 *   2. normalizePayload(raw, harness) -> one Claude-shaped payload, or a
 *      fan-out list (a multi-file Codex apply_patch / omp hashline patch).
 *   3. For each payload: `bash -n <hook>` (syntax gate) then
 *      `bash <hook> [args]` with the Claude-shaped JSON on stdin and the
 *      env the personal hooks rely on (HOME, YOKI_*, CLAUDE_HOOK_EVENT_NAME).
 *   4. translateResponse() turns the hook's Claude-shaped stdout/exit code
 *      into the target harness's wire format; combineDecisions() merges
 *      several fanned-out verdicts (first deny wins) before one final
 *      translation.
 *
 * Fails open (stderr warning, exit 0, no stdout) when the hook file is
 * missing or fails `bash -n` — mirrors the existing
 * `bash -c 'bash -n "$h" && exec bash "$h"'` wrapper in
 * personal/settings.personal.json so a broken personal hook never blocks
 * the agent under any harness. This script does not modify the .sh hooks.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { normalizePayload } = require('../lib/harness/payload');
const { translateResponse, combineDecisions } = require('../lib/harness/response');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let harness;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--harness') {
      harness = args[i + 1];
      i++;
      continue;
    }
    rest.push(args[i]);
  }
  const [hookArg, ...hookArgs] = rest;
  return { harness, hookArg, hookArgs };
}

// Absolute paths pass through; anything else is resolved against ~/.claude,
// the install root the personal settings layer uses for its own hooks.
function resolveHookPath(rawPath) {
  if (!rawPath) return rawPath;
  let p = rawPath;
  if (p === '~' || p.startsWith('~/')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  if (path.isAbsolute(p)) return p;
  return path.join(os.homedir(), '.claude', p);
}

function bashSyntaxOk(hookPath) {
  const result = spawnSync('bash', ['-n', hookPath], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function eventNameOf(payload) {
  return payload && typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';
}

// Same env the personal settings layer's hooks rely on: HOME/YOKI_* come
// from full inheritance; CLAUDE_HOOK_EVENT_NAME is normally set by Claude
// Code itself and must be supplied explicitly under every other harness.
function buildHookEnv(payload) {
  const env = Object.assign({}, process.env);
  const eventName = eventNameOf(payload);
  if (eventName) env.CLAUDE_HOOK_EVENT_NAME = eventName;
  return env;
}

function runHookOnce(hookPath, hookArgs, payload) {
  const result = spawnSync('bash', [hookPath, ...hookArgs], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: buildHookEnv(payload),
  });

  if (result.error) {
    return {
      stdout: '',
      exitCode: 0,
      stderr: `[run-bash-hook] failed to execute ${hookPath}: ${result.error.message}`,
    };
  }

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    exitCode: Number.isInteger(result.status) ? result.status : 0,
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

// Re-renders a fan-out's combined canonical decision as the Claude-shaped
// hook stdout translateResponse() expects, so the same T2 renderer produces
// the final wire format instead of duplicating it here.
function combinedDecisionToClaudeOutput(decision) {
  const out = {};

  if (decision.permissionDecision) {
    out.hookSpecificOutput = {
      permissionDecision: decision.permissionDecision,
    };
    if (decision.reason) out.hookSpecificOutput.permissionDecisionReason = decision.reason;
    if (decision.additionalContext) out.hookSpecificOutput.additionalContext = decision.additionalContext;
    if (decision.updatedInput) out.hookSpecificOutput.updatedInput = decision.updatedInput;
  } else if (decision.additionalContext) {
    out.hookSpecificOutput = { additionalContext: decision.additionalContext };
  }

  if (decision.systemMessage) out.systemMessage = decision.systemMessage;
  if (decision.suppressOutput !== undefined) out.suppressOutput = decision.suppressOutput;

  return { stdout: JSON.stringify(out), exitCode: 0, stderr: '' };
}

function emitAndExit(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
  process.exit(Number.isInteger(result.exitCode) ? result.exitCode : 0);
}

function failOpen(message) {
  process.stderr.write(`${message}\n`);
  process.exit(0);
}

function main() {
  const { harness, hookArg, hookArgs } = parseArgs(process.argv);

  if (!harness || !hookArg) {
    failOpen('[run-bash-hook] usage: run-bash-hook.js --harness <h> <hook.sh> [args...]');
    return;
  }

  const hookPath = resolveHookPath(hookArg);

  if (!fs.existsSync(hookPath)) {
    failOpen(`[run-bash-hook] hook not found, failing open: ${hookPath}`);
    return;
  }

  if (!bashSyntaxOk(hookPath)) {
    failOpen(`[run-bash-hook] syntax check failed, failing open: ${hookPath}`);
    return;
  }

  const rawText = readStdin();
  let rawPayload;
  try {
    rawPayload = rawText.trim() ? JSON.parse(rawText) : {};
  } catch (err) {
    failOpen(`[run-bash-hook] malformed stdin JSON, failing open: ${err.message}`);
    return;
  }

  let normalized;
  try {
    normalized = normalizePayload(rawPayload, harness);
  } catch (err) {
    failOpen(`[run-bash-hook] normalizePayload failed, failing open: ${err.message}`);
    return;
  }

  const { payload, meta } = normalized;
  const payloads = payload !== null ? [payload] : Array.isArray(meta.payloads) ? meta.payloads : [];

  if (payloads.length === 0) {
    process.exit(0);
    return;
  }

  const translated = payloads.map((p) => {
    const raw = runHookOnce(hookPath, hookArgs, p);
    if (raw.stderr) process.stderr.write(raw.stderr.endsWith('\n') ? raw.stderr : `${raw.stderr}\n`);
    return translateResponse({ stdout: raw.stdout, exitCode: raw.exitCode, stderr: '', event: eventNameOf(p) }, harness);
  });

  if (translated.length === 1) {
    emitAndExit(translated[0]);
    return;
  }

  const combined = combineDecisions(translated.map((t) => t.decision));
  const synthetic = combinedDecisionToClaudeOutput(combined);
  const final = translateResponse(
    { stdout: synthetic.stdout, exitCode: synthetic.exitCode, stderr: '', event: eventNameOf(payloads[0]) },
    harness
  );
  emitAndExit(final);
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveHookPath,
  parseArgs,
};
