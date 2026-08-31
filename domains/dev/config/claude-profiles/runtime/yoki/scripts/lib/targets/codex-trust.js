'use strict';

/**
 * Port of `trusthash.py` (scratchpad spike S1+S2, Appendix C) — Codex CLI
 * 0.147's `command_hook_hash` / `version_for_toml`
 * (`config/src/fingerprint.rs` in the `openai/codex` source at
 * `rust-v0.147.0`).
 *
 * A Codex hook handler only runs when its `[hooks.state."<key>"]` entry in
 * the user `config.toml` carries a `trusted_hash` that matches the handler's
 * *current* normalized definition — the hash covers the handler definition
 * alone (not the script file, not hooks.json bytes, not the key), so the
 * installer can compute it deterministically and never needs a human to
 * click "trust" in the TUI. Reproduced byte-for-byte against the existing
 * herdr entry in `~/.codex/config.toml` (see codex-trust.test.js and S1+S2
 * §2.3):
 *
 *   input : {"event_name":"session_start","hooks":[{"async":false,
 *            "command":"bash '/Users/esh2n/.codex/herdr-agent-state.sh'
 *            session","timeout":10,"type":"command"}]}
 *   hash  : sha256:34637d171b45f4595a9a8f510e6091670f0e98e4f14c6581b6a4fd947cc49cd5
 */

const crypto = require('crypto');

/** Events whose handler normalization keeps `additionalContextLimit` when it
 * differs from the default — S1+S2 §2.3. */
const CONTEXT_LIMIT_EVENTS = new Set([
  'pre_tool_use',
  'post_tool_use',
  'session_start',
  'user_prompt_submit',
  'subagent_start',
]);

const DEFAULT_ADDITIONAL_CONTEXT_LIMIT = 2500;

/** camelCase Codex event name → the snake_case `event_label` the hash and
 * the `hooks.state` key both use (S1+S2 §2.2). */
const EVENT_LABELS = Object.freeze({
  PreToolUse: 'pre_tool_use',
  PermissionRequest: 'permission_request',
  PostToolUse: 'post_tool_use',
  PreCompact: 'pre_compact',
  PostCompact: 'post_compact',
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'user_prompt_submit',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
  Stop: 'stop',
});

function eventLabelFor(codexEventName) {
  return EVENT_LABELS[codexEventName] || String(codexEventName || '').trim().toLowerCase();
}

/** Recursively sorts object keys so `JSON.stringify` produces the same
 * compact, deterministic text Rust's `serde_json::to_vec` on a
 * key-sorted `serde_json::Value` would (S1+S2 §2.3: "sort keys
 * recursively, serialize compact"). */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Normalizes one handler the same way Codex's discovery.rs does before
 * hashing: `{type, command, timeout, async, statusMessage?,
 * additionalContextLimit?}`, with `commandWindows` always dropped.
 *
 * @param {{command: string, timeout?: number, async?: boolean,
 *   statusMessage?: string, additionalContextLimit?: number}} handler
 * @param {string} eventLabel snake_case event label (e.g. "session_end")
 */
function normalizeHandler(handler, eventLabel) {
  const isSessionEnd = eventLabel === 'session_end';
  const fallbackTimeout = isSessionEnd ? 1 : 600;
  const rawTimeout = Number.isFinite(handler.timeout) ? handler.timeout : fallbackTimeout;
  const timeout = isSessionEnd
    ? Math.min(3, Math.max(1, rawTimeout))
    : Math.max(1, rawTimeout);

  const normalized = {
    type: 'command',
    command: handler.command,
    timeout,
    async: Boolean(handler.async),
  };

  if (handler.statusMessage) {
    normalized.statusMessage = handler.statusMessage;
  }

  if (
    CONTEXT_LIMIT_EVENTS.has(eventLabel) &&
    Number.isFinite(handler.additionalContextLimit) &&
    handler.additionalContextLimit !== DEFAULT_ADDITIONAL_CONTEXT_LIMIT
  ) {
    normalized.additionalContextLimit = handler.additionalContextLimit;
  }

  return normalized;
}

/**
 * Builds the `NormalizedHookIdentity` Codex hashes for one handler: the
 * event label, the group's matcher (only if the group set one), and a
 * `hooks` array containing that single normalized handler — the hash is
 * per (group, handler) pair, not per group (S1+S2 §2.3: "the hash covers
 * the handler definition only").
 */
function normalizedIdentity({ eventLabel, matcher, handler }) {
  const identity = { event_name: eventLabel, hooks: [normalizeHandler(handler, eventLabel)] };
  if (matcher !== undefined && matcher !== null) {
    identity.matcher = matcher;
  }
  return identity;
}

/** The exact canonical text that gets SHA-256'd — exposed for tests/debugging. */
function canonicalJson(identity) {
  return JSON.stringify(sortKeysDeep(identity));
}

/**
 * @param {{eventLabel?: string, event?: string, matcher?: string,
 *   handler: {command: string, timeout?: number, async?: boolean,
 *   statusMessage?: string, additionalContextLimit?: number}}} args
 *   Pass either `eventLabel` (snake_case, e.g. "session_start") or `event`
 *   (Codex/Claude event name, e.g. "SessionStart") — `eventLabel` wins if
 *   both are given.
 * @returns {string} `"sha256:<hex>"`
 */
function computeHandlerHash(args) {
  const eventLabel = args.eventLabel || eventLabelFor(args.event);
  const json = canonicalJson(normalizedIdentity({ eventLabel, matcher: args.matcher, handler: args.handler }));
  const digest = crypto.createHash('sha256').update(json, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

/**
 * The `[hooks.state."<key>"]` table key: `<key_source>:<event_label>:<group_index>:<handler_index>`
 * (S1+S2 §2.2). Indices are positional — reordering groups/handlers re-keys them.
 */
function hookStateKey(keySource, eventLabel, groupIndex, handlerIndex) {
  return `${keySource}:${eventLabel}:${groupIndex}:${handlerIndex}`;
}

module.exports = {
  EVENT_LABELS,
  CONTEXT_LIMIT_EVENTS,
  DEFAULT_ADDITIONAL_CONTEXT_LIMIT,
  eventLabelFor,
  sortKeysDeep,
  normalizeHandler,
  normalizedIdentity,
  canonicalJson,
  computeHandlerHash,
  hookStateKey,
};
