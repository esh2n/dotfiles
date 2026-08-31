#!/usr/bin/env node
/**
 * Harness response translator.
 *
 * yoki hooks always emit Claude-shaped output today:
 *   - PreToolUse deny via `exit 2` + a stderr reason
 *   - JSON on stdout: { hookSpecificOutput: { hookEventName, permissionDecision,
 *     permissionDecisionReason, additionalContext, updatedInput } }
 *   - Stop/SubagentStop: { decision: 'block', reason } or the older
 *     { continue: false, stopReason }
 *   - SessionStart/UserPromptSubmit: { hookSpecificOutput: { additionalContext } }
 *   - top-level `systemMessage` / `suppressOutput`
 *
 * translateResponse() parses that Claude-shaped output into a harness-agnostic
 * canonical `decision`, then re-renders it as the wire format the target
 * harness expects:
 *   - codex: near-identical JSON-on-stdout / exit-2-blocks contract, except
 *     'ask' (meaningless under non-interactive exec) is rewritten to 'deny',
 *     and Stop/SubagentStop stdout is stripped down to JSON-or-empty.
 *   - omp: an event-shaped JS object handed back to the omp bridge (tool_call,
 *     tool_result, session_stop, before_agent_start, session_before_compact).
 *
 * combineDecisions() merges several canonical decisions (one per hook that
 * fired for the same event) for the T1 fan-out case: first deny wins,
 * additionalContext is concatenated.
 */

'use strict';

const OMP_EVENT_MAP = {
  PreToolUse: 'tool_call',
  PostToolUse: 'tool_result',
  Stop: 'session_stop',
  SubagentStop: 'session_stop',
  SessionStart: 'before_agent_start',
  UserPromptSubmit: 'before_agent_start',
  PreCompact: 'session_before_compact',
};

const STOP_FAMILY_EVENTS = new Set(['Stop', 'SubagentStop']);

function safeParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === 'object' ? value : null;
  } catch {
    // Malformed JSON stdout is plain text, not a decision.
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

// Parses Claude-shaped { stdout, exitCode, stderr, event } into an internal
// "effects" record. Fields beyond the canonical decision (exit2Blocked,
// exit2Reason, jsonStopBlocked, plainText) exist only to let the per-harness
// renderers pick the right wire encoding.
function parseClaudeHookOutput({ stdout, exitCode, stderr, event } = {}) {
  const eventName = String(event || '');
  const stderrText = String(stderr || '').trim();
  const exit2Blocked = exitCode === 2;
  const exit2Reason = exit2Blocked ? (stderrText || `blocked by hook ${eventName}`) : undefined;

  const effects = {
    event: eventName,
    blocked: exit2Blocked,
    reason: exit2Reason,
    permissionDecision: undefined,
    additionalContext: undefined,
    updatedInput: undefined,
    systemMessage: undefined,
    suppressOutput: undefined,
    exit2Blocked,
    exit2Reason,
    jsonStopBlocked: false,
    plainText: undefined,
  };

  const parsed = safeParseJson(stdout);
  if (parsed === null) {
    effects.plainText = nonEmptyString(String(stdout || '').trim());
    return effects;
  }

  effects.systemMessage = nonEmptyString(parsed.systemMessage);
  if (typeof parsed.suppressOutput === 'boolean') effects.suppressOutput = parsed.suppressOutput;

  const hso = parsed.hookSpecificOutput;
  if (hso && typeof hso === 'object') {
    if (['deny', 'allow', 'ask'].includes(hso.permissionDecision)) {
      effects.permissionDecision = hso.permissionDecision;
      const reason = nonEmptyString(hso.permissionDecisionReason);
      if (reason) effects.reason = reason;
      if (hso.permissionDecision === 'deny') effects.blocked = true;
    }
    effects.additionalContext = nonEmptyString(hso.additionalContext);
    if (hso.updatedInput && typeof hso.updatedInput === 'object') {
      effects.updatedInput = hso.updatedInput;
    }
  }

  if (parsed.decision === 'block' || parsed.continue === false) {
    effects.blocked = true;
    effects.jsonStopBlocked = true;
    const reason = nonEmptyString(parsed.decision === 'block' ? parsed.reason : parsed.stopReason);
    if (reason) effects.reason = reason;
  }

  return effects;
}

// 'ask' has no meaning once permission_mode is bypassPermissions (exec-style
// harnesses can't prompt) — collapse it to 'deny' and say why in the reason.
function mapAskForExec(effects, harnessName) {
  if (effects.permissionDecision !== 'ask') return effects;
  const prefix = `[ask→deny on ${harnessName}] `;
  const reason = effects.reason ? `${prefix}${effects.reason}` : prefix.trim();
  return { ...effects, permissionDecision: 'deny', blocked: true, reason };
}

function toCanonicalDecision(effects) {
  return {
    blocked: effects.blocked,
    permissionDecision: effects.permissionDecision,
    reason: effects.reason,
    additionalContext: effects.additionalContext,
    updatedInput: effects.updatedInput,
    systemMessage: effects.systemMessage,
    suppressOutput: effects.suppressOutput,
  };
}

function buildCodexPayload(effects) {
  const payload = {};

  if (effects.permissionDecision) {
    payload.hookSpecificOutput = {
      hookEventName: effects.event,
      permissionDecision: effects.permissionDecision,
    };
    if (effects.reason) payload.hookSpecificOutput.permissionDecisionReason = effects.reason;
    if (effects.additionalContext) payload.hookSpecificOutput.additionalContext = effects.additionalContext;
    if (effects.updatedInput) payload.hookSpecificOutput.updatedInput = effects.updatedInput;
  } else if (effects.jsonStopBlocked) {
    payload.decision = 'block';
    if (effects.reason) payload.reason = effects.reason;
  } else if (effects.additionalContext) {
    payload.hookSpecificOutput = { hookEventName: effects.event, additionalContext: effects.additionalContext };
  }

  if (effects.systemMessage) payload.systemMessage = effects.systemMessage;
  if (effects.suppressOutput !== undefined) payload.suppressOutput = effects.suppressOutput;

  return payload;
}

function renderForCodex(rawEffects, input) {
  const effects = mapAskForExec(rawEffects, 'codex');
  const decision = toCanonicalDecision(effects);
  const payload = buildCodexPayload(effects);

  if (Object.keys(payload).length > 0) {
    return { stdout: JSON.stringify(payload), exitCode: 0, stderr: '', decision };
  }

  if (effects.exit2Blocked) {
    return { stdout: '', exitCode: 2, stderr: effects.exit2Reason, decision };
  }

  if (STOP_FAMILY_EVENTS.has(effects.event)) {
    // Stop/SubagentStop stdout must be JSON only — strip any stray plain text.
    return { stdout: '', exitCode: input.exitCode ?? 0, stderr: String(input.stderr || ''), decision };
  }

  // Nothing decision-relevant was found: pass the hook's own output through.
  return {
    stdout: String(input.stdout || ''),
    exitCode: input.exitCode ?? 0,
    stderr: String(input.stderr || ''),
    decision,
  };
}

function buildOmpPayload(effects) {
  const category = OMP_EVENT_MAP[effects.event];

  if (category === 'tool_call') {
    if (effects.blocked) return { block: true, reason: effects.reason || '' };
    if (effects.updatedInput) return { input: effects.updatedInput };
    return {};
  }

  if (category === 'tool_result') {
    if (effects.blocked) return { content: effects.reason || '', isError: true };
    if (effects.additionalContext) return { content: effects.additionalContext };
    return {};
  }

  if (category === 'session_stop') {
    if (effects.blocked) return { decision: 'block', reason: effects.reason || '' };
    return effects.additionalContext
      ? { continue: true, additionalContext: effects.additionalContext }
      : { continue: true };
  }

  if (category === 'before_agent_start') {
    return effects.additionalContext
      ? { message: { role: 'user', content: effects.additionalContext } }
      : {};
  }

  if (category === 'session_before_compact') {
    const summary = effects.additionalContext || effects.plainText || effects.systemMessage;
    return summary ? { summary } : {};
  }

  // Unrecognized event: best-effort so nothing is silently dropped.
  if (effects.blocked) return { block: true, reason: effects.reason || '' };
  if (effects.additionalContext) return { content: effects.additionalContext };
  return {};
}

function renderForOmp(rawEffects) {
  const effects = mapAskForExec(rawEffects, 'omp');
  const payload = buildOmpPayload(effects);

  return {
    stdout: JSON.stringify(payload),
    exitCode: 0,
    stderr: '',
    decision: toCanonicalDecision(effects),
  };
}

/**
 * Translates Claude-shaped hook output into the wire format a target harness
 * expects.
 *
 * @param {{stdout?: string, exitCode?: number, stderr?: string, event?: string}} input
 * @param {'codex'|'omp'|string|undefined} harness
 * @returns {{stdout: string, exitCode: number, stderr: string, decision: object}}
 */
function translateResponse(input, harness) {
  const safeInput = input && typeof input === 'object' ? input : {};
  const effects = parseClaudeHookOutput(safeInput);
  const harnessName = String(harness || '').trim().toLowerCase();

  if (harnessName === 'codex') return renderForCodex(effects, safeInput);
  if (harnessName === 'omp') return renderForOmp(effects, safeInput);

  // Unknown/absent harness: leave the Claude-shaped response untouched, but
  // still surface the canonical decision for callers that want it.
  return {
    stdout: String(safeInput.stdout || ''),
    exitCode: safeInput.exitCode ?? 0,
    stderr: String(safeInput.stderr || ''),
    decision: toCanonicalDecision(effects),
  };
}

/**
 * Combines the canonical `decision` of several hooks that fired for the same
 * event (T1 fan-out): the first blocking decision wins, and every non-empty
 * additionalContext is concatenated in order with '\n'.
 *
 * @param {object[]} list
 * @returns {object} canonical decision
 */
function combineDecisions(list) {
  const decisions = Array.isArray(list) ? list : [];

  const combined = {
    blocked: false,
    permissionDecision: undefined,
    reason: undefined,
    additionalContext: undefined,
    updatedInput: undefined,
    systemMessage: undefined,
    suppressOutput: undefined,
  };

  const contexts = [];
  const systemMessages = [];

  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') continue;

    if (nonEmptyString(decision.additionalContext)) contexts.push(decision.additionalContext);
    if (nonEmptyString(decision.systemMessage)) systemMessages.push(decision.systemMessage);
    if (decision.updatedInput && typeof decision.updatedInput === 'object') {
      combined.updatedInput = decision.updatedInput; // last writer wins
    }
    if (decision.suppressOutput !== undefined) combined.suppressOutput = decision.suppressOutput;

    if (!combined.blocked && decision.blocked) {
      combined.blocked = true;
      combined.reason = decision.reason;
      combined.permissionDecision = decision.permissionDecision || 'deny';
    }
  }

  if (contexts.length > 0) combined.additionalContext = contexts.join('\n');
  if (systemMessages.length > 0) combined.systemMessage = systemMessages.join('\n');

  return combined;
}

module.exports = {
  translateResponse,
  combineDecisions,
};
