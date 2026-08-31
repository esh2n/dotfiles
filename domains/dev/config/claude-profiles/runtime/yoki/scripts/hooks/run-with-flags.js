#!/usr/bin/env node
/**
 * Executes a hook script only when enabled by ECC hook profile flags.
 *
 * Usage:
 *   node run-with-flags.js <hookId> <scriptRelativePath> [profilesCsv] [--harness <claude|codex|omp>]
 *
 * `--harness` may appear anywhere in argv and is stripped before the
 * positional args are read, so existing Claude Code call sites (which never
 * pass it) are unaffected. When it names a non-Claude harness, the incoming
 * stdin event is normalized into Claude's hook schema (see
 * `../lib/harness/payload`), the hook runs unmodified against that
 * normalized shape (once per fanned-out payload for a multi-file patch),
 * and the collected result is translated back into that harness's wire
 * format (see `../lib/harness/response`) before this process exits.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isHookEnabled, isDryRun } = require('../lib/hook-flags');
const { buildPreToolUseAdditionalContext } = require('./pretooluse-visible-output');
const { normalizePayload } = require('../lib/harness/payload');
const { translateResponse, combineDecisions } = require('../lib/harness/response');

const MAX_STDIN = 1024 * 1024;
const KNOWN_HARNESSES = new Set(['claude', 'codex', 'omp']);

// Pulls `--harness <value>` (or `--harness=value`) out of argv wherever it
// appears, returning the raw value found (if any) plus the remaining args in
// their original order so `<hookId> <scriptRelativePath> [profilesCsv]`
// parsing is unaffected by where the flag was placed.
function extractHarnessFlag(argv) {
  const args = argv.slice();
  let harness;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--harness') {
      harness = args[i + 1];
      args.splice(i, 2);
      break;
    }
    const eq = /^--harness=(.*)$/.exec(args[i]);
    if (eq) {
      harness = eq[1];
      args.splice(i, 1);
      break;
    }
  }

  return { harness, rest: args };
}

// Unknown/missing values fail open to 'claude' rather than reject the call —
// a hook runner must never become the reason a tool call is blocked.
function resolveHarness(flagValue) {
  const candidate = String(flagValue || process.env.YOKI_HARNESS || 'claude').trim().toLowerCase();
  return KNOWN_HARNESSES.has(candidate) ? candidate : 'claude';
}

function readStdinRaw() {
  return new Promise(resolve => {
    let raw = '';
    let truncated = false;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (raw.length < MAX_STDIN) {
        const remaining = MAX_STDIN - raw.length;
        raw += chunk.substring(0, remaining);
        if (chunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });
    process.stdin.on('end', () => resolve({ raw, truncated }));
    process.stdin.on('error', () => resolve({ raw, truncated }));
  });
}

function writeStderr(stderr) {
  if (typeof stderr !== 'string' || stderr.length === 0) {
    return;
  }

  process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
}

/**
 * Write stdout fully, then exit. `process.exit()` immediately after
 * `process.stdout.write()` drops anything beyond the ~64KB pipe buffer,
 * which cut large pass-through payloads mid-JSON and made the harness
 * treat the hook as failed (#2222). The write callback fires only after
 * the chunk is flushed to the pipe.
 */
function exitWithStdout(text, exitCode) {
  if (typeof text !== 'string' || text.length === 0) {
    process.exit(exitCode);
  }
  process.stdout.write(text, () => process.exit(exitCode));
}

// Normalizes whatever a hook's run() returned into {stdout, exitCode, stderr}.
// The stderr text is returned rather than written here, so the caller decides
// whether it goes straight to this process's stderr (the Claude path) or
// through translateResponse first (the non-Claude harness bridge).
function resolveHookResult(raw, output) {
  if (typeof output === 'string' || Buffer.isBuffer(output)) {
    return { stdout: String(output), exitCode: 0, stderr: '' };
  }

  if (output && typeof output === 'object') {
    const stderrText = typeof output.stderr === 'string' ? output.stderr : '';
    const exitCode = Number.isInteger(output.exitCode) ? output.exitCode : 0;

    if (Object.prototype.hasOwnProperty.call(output, 'additionalContext')) {
      return { stdout: buildPreToolUseAdditionalContext(output.additionalContext), exitCode, stderr: stderrText };
    }
    if (Object.prototype.hasOwnProperty.call(output, 'stdout')) {
      return { stdout: String(output.stdout ?? ''), exitCode, stderr: stderrText };
    }
    return { stdout: exitCode === 0 ? raw : '', exitCode, stderr: stderrText };
  }

  return { stdout: raw, exitCode: 0, stderr: '' };
}

function resolveLegacySpawnStdout(raw, result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (stdout) {
    return stdout;
  }

  if (Number.isInteger(result.status) && result.status === 0) {
    return raw;
  }

  return '';
}

// Sets env vars for the duration of `fn`, restoring (or deleting, if unset
// before) each one afterward. Used to expose YOKI_HARNESS /
// CLAUDE_HOOK_EVENT_NAME to a require()'d hook's run() without leaking them
// into the parent process's env once that call returns.
function withTempEnv(extraEnv, fn) {
  const keys = Object.keys(extraEnv);
  const saved = {};
  for (const key of keys) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    process.env[key] = extraEnv[key];
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// Runs one hook invocation (require() fast path or legacy spawnSync) against
// an already Claude-shaped payload and returns {stdout, exitCode, stderr}
// instead of writing/exiting. Both entry points use it — the Claude path
// writes the result out directly, the non-Claude harness bridge translates it
// first — so the invocation mechanics exist exactly once.
function runHookOnce(rawForHook, ctx) {
  const { hookModule, hasRunExport, hookId, pluginRoot, scriptPath, truncated, extraEnv } = ctx;

  if (hasRunExport && hookModule && typeof hookModule.run === 'function') {
    return withTempEnv(extraEnv, () => {
      try {
        const output = hookModule.run(rawForHook, {
          hookId,
          pluginRoot,
          scriptPath,
          truncated,
          maxStdin: MAX_STDIN
        });
        return resolveHookResult(rawForHook, output);
      } catch (runErr) {
        process.stderr.write(`[Hook] run() error for ${hookId}: ${runErr.message}\n`);
        return { stdout: rawForHook, exitCode: 0, stderr: '' };
      }
    });
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    input: rawForHook,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      YOKI_PLUGIN_ROOT: pluginRoot,
      YOKI_HOOK_ID: hookId,
      YOKI_HOOK_INPUT_TRUNCATED: truncated ? '1' : '0',
      YOKI_HOOK_INPUT_MAX_BYTES: String(MAX_STDIN),
      ...extraEnv
    },
    cwd: process.cwd(),
    timeout: 30000
  });

  const stdout = resolveLegacySpawnStdout(rawForHook, result);
  const stderrText = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.error || result.signal || result.status === null) {
    const failureDetail = result.error ? result.error.message : result.signal ? `terminated by signal ${result.signal}` : 'missing exit status';
    const failureLine = `[Hook] legacy hook execution failed for ${hookId}: ${failureDetail}`;
    return {
      stdout,
      exitCode: 1,
      stderr: stderrText ? `${stderrText.replace(/\n+$/, '')}\n${failureLine}` : failureLine
    };
  }

  return { stdout, exitCode: Number.isInteger(result.status) ? result.status : 0, stderr: stderrText };
}

// Re-renders a combined canonical decision (T2's combineDecisions output)
// as a Claude-shaped hook response, so it can be fed back through
// translateResponse to get the final harness-specific wire format. Only
// PreToolUse/PostToolUse ever fan out into several payloads (see
// ../lib/harness/payload), so the hookSpecificOutput encoding below is
// always the correct shape to round-trip through.
function buildClaudeOutputFromDecision(decision, event) {
  const canonical = decision || {};
  const hookSpecificOutput = {};
  let hasHookSpecificOutput = false;

  // A verdict is a verdict whether or not it blocks: an explicit 'allow'
  // (auto-approve) or 'ask' must survive the round trip, not be flattened
  // into "no opinion" because only `blocked` was checked here.
  if (canonical.blocked || canonical.permissionDecision) {
    hookSpecificOutput.permissionDecision =
      canonical.permissionDecision || (canonical.blocked ? 'deny' : undefined);
    hasHookSpecificOutput = true;
    if (canonical.reason) hookSpecificOutput.permissionDecisionReason = canonical.reason;
  }
  if (canonical.additionalContext) {
    hookSpecificOutput.additionalContext = canonical.additionalContext;
    hasHookSpecificOutput = true;
  }
  if (canonical.updatedInput && typeof canonical.updatedInput === 'object') {
    hookSpecificOutput.updatedInput = canonical.updatedInput;
    hasHookSpecificOutput = true;
  }

  const payload = {};
  if (hasHookSpecificOutput) {
    payload.hookSpecificOutput = Object.assign({ hookEventName: event }, hookSpecificOutput);
  }
  if (canonical.systemMessage) payload.systemMessage = canonical.systemMessage;
  if (canonical.suppressOutput !== undefined) payload.suppressOutput = canonical.suppressOutput;

  // With nothing JSON-shaped to encode, plain stdout is still the hooks'
  // answer — Claude adds a hook's non-JSON stdout to the model's context
  // verbatim — so re-emit it as plain text instead of an empty string.
  const stdout = Object.keys(payload).length > 0
    ? JSON.stringify(payload)
    : (canonical.plainText || '');

  return { stdout, exitCode: 0, stderr: '' };
}

// Non-Claude harness bridge: normalize the raw event into Claude's hook
// schema, run the hook once per fanned-out payload, translate each result
// into a canonical decision, combine them (first deny wins), then render the
// combined decision back into the target harness's wire format.
function runHarnessBridge({ raw, harness, hookId, pluginRoot, scriptPath, truncated, hookModule, hasRunExport, sanitizeEcho }) {
  let rawEvent;
  try {
    rawEvent = raw.trim() ? JSON.parse(raw) : {};
  } catch (parseErr) {
    process.stderr.write(`[Hook] failed to parse ${harness} stdin for ${hookId}: ${parseErr.message}\n`);
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  let normalized;
  try {
    normalized = normalizePayload(rawEvent, harness);
  } catch (normalizeErr) {
    process.stderr.write(`[Hook] normalizePayload failed for ${hookId}: ${normalizeErr.message}\n`);
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  const payloads = normalized.payload !== null
    ? [normalized.payload]
    : (normalized.meta && Array.isArray(normalized.meta.payloads) ? normalized.meta.payloads : []);

  if (payloads.length === 0) {
    // Echoing the raw event with exit 0 is "no opinion", which is only an
    // honest answer for an event that carries no tool call. A tool event
    // whose fan-out came back empty means no guard hook ever saw it —
    // payload.js falls back to a raw single payload so this should be
    // unreachable, but say so if it ever is.
    if (normalized.meta && normalized.meta.emptyFanout) {
      process.stderr.write(
        `[Hook] ${harness} tool event produced no payload for ${hookId}; no hook ran (failing open)\n`
      );
    }
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  const decisions = [];
  const translations = [];
  let event = '';

  for (const payloadItem of payloads) {
    const rawForHook = JSON.stringify(payloadItem);
    event = typeof payloadItem.hook_event_name === 'string' ? payloadItem.hook_event_name : event;

    const runResult = runHookOnce(rawForHook, {
      hookModule,
      hasRunExport,
      hookId,
      pluginRoot,
      scriptPath,
      truncated,
      extraEnv: { YOKI_HARNESS: harness, CLAUDE_HOOK_EVENT_NAME: event }
    });

    // Echoing the input back is Claude's pass-through idiom for "no opinion".
    // Under codex/omp that echo would be the *normalized event* offered as if
    // it were a hook response, so drop it rather than forward it.
    const hookStdout = runResult.stdout === rawForHook ? '' : runResult.stdout;

    const translated = translateResponse(
      { stdout: hookStdout, exitCode: runResult.exitCode, stderr: runResult.stderr, event },
      harness
    );
    decisions.push(translated.decision);
    translations.push(translated);
  }

  // One payload means there is nothing to combine: emit what T2 already
  // rendered, exactly as run-bash-hook.js does. Re-encoding it from the
  // canonical decision would drop everything the decision cannot carry —
  // plain-text stdout above all — and would silently make the two entry
  // points into the same pipeline disagree.
  if (translations.length === 1) {
    writeStderr(translations[0].stderr);
    exitWithStdout(translations[0].stdout, translations[0].exitCode);
    return;
  }

  const combined = combineDecisions(decisions);
  const synthetic = buildClaudeOutputFromDecision(combined, event);
  const final = translateResponse(Object.assign({}, synthetic, { event }), harness);

  writeStderr(final.stderr);
  exitWithStdout(final.stdout, final.exitCode);
}

function getPluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.trim()) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  return path.resolve(__dirname, '..', '..');
}

//Safely extract target context from hook stdin JSON for dry-run preview.

function extractTargetContext(raw) {
  const result = { tool: '', filePath: '', command: '' };
  if (!raw || typeof raw !== 'string') return result;

  try {
    const payload = JSON.parse(raw);
    if (payload && typeof payload === 'object') {
      result.tool = String(payload.tool || '');
      const input = payload.tool_input;
      if (input && typeof input === 'object') {
        result.filePath = String(input.file_path || input.path || '');
        result.command = String(input.command || '');
      }
    }
  } catch {
    // best-effort field extraction; ignore malformed input
  }
  return result;
}

// Build the [DryRun] preview line for stderr.

function buildDryRunPreview(hookId, relScriptPath, profilesCsv, raw) {
  const ctx = extractTargetContext(raw);
  const parts = [`[DryRun] Hook "${hookId}" would execute: ${relScriptPath}`, `(enabled=true, profiles=${profilesCsv || 'default'})`];

  if (ctx.tool) {
    parts.push(`tool=${ctx.tool}`);
  }
  if (ctx.filePath) {
    parts.push(`target=${ctx.filePath}`);
  }
  if (ctx.command) {
    parts.push(`command=${ctx.command}`);
  }

  return parts.join(' ') + '\n';
}

async function main() {
  const { harness: harnessArg, rest: positional } = extractHarnessFlag(process.argv.slice(2));
  const harness = resolveHarness(harnessArg);
  const [hookId, relScriptPath, profilesCsv] = positional;
  const { raw, truncated } = await readStdinRaw();

  // Oversized payloads: never echo the truncated string — a JSON document
  // cut mid-stream is treated by the harness as a hook failure, blocking the
  // tool call (#2222). Empty stdout + exit 0 means "no opinion", so
  // pass-through paths fail open. The hook itself still runs and receives
  // the truncated flag (run() context / YOKI_HOOK_INPUT_TRUNCATED), so
  // security hooks like config-protection can still choose to block.
  const sanitizeEcho = text => (truncated && text === raw ? '' : text);
  if (truncated) {
    process.stderr.write(`[Hook] stdin exceeded ${MAX_STDIN} bytes for ${hookId || 'unknown'}; suppressing pass-through (fail-open unless the hook blocks)\n`);
  }

  if (!hookId || !relScriptPath) {
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (!isHookEnabled(hookId, { profiles: profilesCsv })) {
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (isDryRun()) {
    const preview = buildDryRunPreview(hookId, relScriptPath, profilesCsv, raw);
    process.stderr.write(preview);
    process.stdout.write(raw);
    process.exit(0);
  }

  const pluginRoot = getPluginRoot();
  const resolvedRoot = path.resolve(pluginRoot);
  const scriptPath = path.resolve(pluginRoot, relScriptPath);

  // Prevent path traversal outside the plugin root
  if (!scriptPath.startsWith(resolvedRoot + path.sep)) {
    process.stderr.write(`[Hook] Path traversal rejected for ${hookId}: ${scriptPath}\n`);
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`[Hook] Script not found for ${hookId}: ${scriptPath}\n`);
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  // Prefer direct require() when the hook exports a run(rawInput) function.
  // This eliminates one Node.js process spawn (~50-100ms savings per hook).
  //
  // SAFETY: Only require() hooks that export run(). Legacy hooks execute
  // side effects at module scope (stdin listeners, process.exit, main() calls)
  // which would interfere with the parent process or cause double execution.
  let hookModule;
  const src = fs.readFileSync(scriptPath, 'utf8');
  const hasRunExport = /\bmodule\.exports\b/.test(src) && /\brun\b/.test(src);

  if (hasRunExport) {
    try {
      hookModule = require(scriptPath);
    } catch (requireErr) {
      process.stderr.write(`[Hook] require() failed for ${hookId}: ${requireErr.message}\n`);
      // Fall through to legacy spawnSync path
    }
  }

  if (harness !== 'claude') {
    runHarnessBridge({ raw, harness, hookId, pluginRoot, scriptPath, truncated, hookModule, hasRunExport, sanitizeEcho });
    return;
  }

  // The Claude path runs the very same invocation mechanics as the harness
  // bridge (require() fast path, else a legacy child process), so it goes
  // through runHookOnce too — one implementation of the env vars, the
  // timeout and the error normalization, rather than two that drift apart.
  const result = runHookOnce(raw, {
    hookModule,
    hasRunExport,
    hookId,
    pluginRoot,
    scriptPath,
    truncated,
    extraEnv: {}
  });

  writeStderr(result.stderr);
  exitWithStdout(sanitizeEcho(result.stdout), result.exitCode);
}

main().catch(err => {
  process.stderr.write(`[Hook] run-with-flags error: ${err.message}\n`);
  process.exit(0);
});
