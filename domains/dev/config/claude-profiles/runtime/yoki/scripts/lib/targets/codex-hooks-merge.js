'use strict';

/**
 * Builds `~/.codex/hooks.json` from the layered Claude settings files and
 * merges it into whatever is already at the destination, keeping foreign
 * groups (herdr, or any other tool's) byte-for-byte in place — spike
 * S1+S2 §3 "Recommendation".
 *
 * Only hook commands that already go through `run-with-flags.js` or
 * `run-bash-hook.js` are portable: they are the only commands whose payload
 * gets normalized into the shape the hook script actually expects (see
 * ../harness/payload.js). A raw one-off `bash -c '...'` hook (this repo's
 * personal git-guard.sh/mcp-audit.sh/etc — see personal/settings.personal.json)
 * reads Claude's own stdin shape directly and has no such normalization, so
 * it is left out of the Codex output with a warning rather than shipped
 * broken.
 */

const { eventLabelFor, computeHandlerHash, hookStateKey } = require('./codex-trust');

/** Claude Code hook event names Codex has a same-named equivalent for
 * (S1+S2 §1.1; PermissionRequest/PreCompact/PostCompact are real Codex
 * events but unreachable from `codex exec` — still passed through 1:1 when
 * a layer declares them, since the TUI does reach them). */
const KNOWN_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreCompact',
  'SubagentStart',
  'SubagentStop',
]);

const MATCHER_MAP = new Map([
  ['Bash', 'Bash'],
  ['Write|Edit|MultiEdit', 'Write|Edit|apply_patch'],
  ['mcp__.*', 'mcp__.*'],
]);

const RUNNER_RE = /run-with-flags\.js|run-bash-hook\.js/;
const HARNESS_FLAG_RE = /(--harness[=\s]+)(\S+)/;

function isRunnerCommand(command) {
  return typeof command === 'string' && RUNNER_RE.test(command);
}

/** True for a hook command this generator itself would emit for Codex —
 * used to tell "ours, regenerate" apart from "foreign, preserve" groups
 * already sitting in the destination hooks.json. */
function isYokiCodexCommand(command) {
  return isRunnerCommand(command) && /--harness\s+codex\b/.test(command);
}

function groupIsOurs(group) {
  const hooks = Array.isArray(group && group.hooks) ? group.hooks : [];
  return hooks.length > 0 && hooks.every(h => isYokiCodexCommand(h && h.command));
}

/** `"Edit|Write|MultiEdit"` and `"Write|Edit|MultiEdit"` are the same
 * matcher to Claude (order is irrelevant) — canonicalize by sorting the
 * `|`-separated tool names before comparing against MATCHER_MAP, so the
 * translation doesn't silently miss a group just because a layer wrote the
 * tools in a different order than another layer did. */
function canonicalMatcher(matcher) {
  return String(matcher || '').split('|').map(s => s.trim()).filter(Boolean).sort().join('|');
}

const MATCHER_MAP_BY_CANONICAL = new Map(
  [...MATCHER_MAP.entries()].map(([key, value]) => [canonicalMatcher(key), value])
);

/**
 * @returns {string|null} the Codex matcher, or null when the Claude matcher
 *   (`Workflow` — no Workflow tool on Codex) has no equivalent at all.
 */
function translateMatcher(matcher) {
  if (matcher === 'Workflow') return null;
  const canonical = canonicalMatcher(matcher);
  return MATCHER_MAP_BY_CANONICAL.has(canonical) ? MATCHER_MAP_BY_CANONICAL.get(canonical) : matcher;
}

function translateCommand(command) {
  if (HARNESS_FLAG_RE.test(command)) {
    return command.replace(HARNESS_FLAG_RE, '$1codex');
  }
  return `${command} --harness codex`;
}

function appendIfFlag(command, ifClause) {
  if (!ifClause) return command;
  return `${command} --if ${JSON.stringify(String(ifClause))}`;
}

/**
 * @param {Array<{event: string, matcher: string, hooks: Array<object>}>} rawGroups
 *   flattened groups from every layer's settings `hooks[event]`, in layer order
 * @param {string} eventName Claude event name (also the Codex event name)
 * @returns {{groups: Array<object>, warnings: string[]}}
 */
function translateEventGroups(eventName, rawGroups) {
  const groups = [];
  const warnings = [];

  for (const group of rawGroups) {
    const matcher = translateMatcher(group.matcher);
    if (matcher === null) {
      warnings.push(`codex: ${eventName} matcher "${group.matcher}" has no Codex equivalent (no Workflow tool) — group skipped`);
      continue;
    }

    const hooks = [];
    for (const handler of Array.isArray(group.hooks) ? group.hooks : []) {
      if (!isRunnerCommand(handler.command)) {
        warnings.push(`codex: ${eventName}/${matcher} hook "${String(handler.command).slice(0, 60)}..." does not go through run-with-flags.js/run-bash-hook.js — skipped (not portable to Codex's payload shape)`);
        continue;
      }
      const translated = { type: 'command', command: appendIfFlag(translateCommand(handler.command), handler.if) };
      if (handler.async !== undefined) translated.async = handler.async;
      translated.timeout = eventName === 'SessionEnd' ? 3 : handler.timeout;
      if (translated.timeout === undefined) delete translated.timeout;
      hooks.push(translated);
    }

    if (hooks.length > 0) groups.push({ matcher, hooks });
  }

  return { groups, warnings };
}

/**
 * @param {Array<{hooks?: Record<string, Array<object>>}>} settingsLayers
 *   parsed settings.layer.json/settings.personal.json contents, in layer order
 * @returns {{generated: Record<string, Array<object>>, warnings: string[]}}
 */
function buildGeneratedGroups(settingsLayers) {
  const warnings = [];
  const generated = {};

  const eventsSeen = new Set();
  for (const layer of settingsLayers) {
    for (const eventName of Object.keys((layer && layer.hooks) || {})) {
      eventsSeen.add(eventName);
    }
  }

  for (const eventName of eventsSeen) {
    if (!KNOWN_EVENTS.has(eventName)) {
      if (eventName === 'Notification') {
        warnings.push('codex: Notification is not a Codex hook event (see codex-notify.js / config.toml `notify`) — skipped');
      } else {
        warnings.push(`codex: hook event "${eventName}" has no known Codex equivalent — skipped`);
      }
      continue;
    }
    const rawGroups = settingsLayers.flatMap(layer => ((layer && layer.hooks && layer.hooks[eventName]) || []));
    const { groups, warnings: groupWarnings } = translateEventGroups(eventName, rawGroups);
    warnings.push(...groupWarnings);
    if (groups.length > 0) generated[eventName] = groups;
  }

  return { generated, warnings };
}

/**
 * Merges `generated` groups into `existing` hooks.json content: within each
 * event, foreign groups (anything not recognizably ours) keep their
 * position and order; our own previously-generated groups are dropped and
 * replaced by the freshly generated ones, appended at the end.
 *
 * @param {object} existing parsed existing hooks.json (or `{}`)
 * @param {Record<string, Array<object>>} generated from buildGeneratedGroups
 * @returns {object} the merged hooks.json content
 */
function mergeHooksJson(existing, generated) {
  const result = {};
  const eventNames = new Set([...Object.keys(existing || {}), ...Object.keys(generated)]);

  for (const eventName of eventNames) {
    const existingGroups = Array.isArray(existing && existing[eventName]) ? existing[eventName] : [];
    const foreignGroups = existingGroups.filter(g => !groupIsOurs(g));
    const newGroups = generated[eventName] || [];
    const finalGroups = [...foreignGroups, ...newGroups];
    if (finalGroups.length > 0) result[eventName] = finalGroups;
  }

  return result;
}

/**
 * Derives `[hooks.state]` trust entries from the FINAL merged hooks.json —
 * positional indices are read off the merged content so a foreign group
 * ahead of ours in the same event correctly shifts our indices (S1+S2 §2.2,
 * §2.3 point 4a in the S1+S2 recommendation).
 *
 * @param {object} mergedHooksJson
 * @param {string} hooksJsonAbsPath absolute path of the destination hooks.json
 * @returns {Array<{key: string, trustedHash: string}>}
 */
function collectHookStateEntries(mergedHooksJson, hooksJsonAbsPath) {
  const entries = [];
  for (const eventName of Object.keys(mergedHooksJson)) {
    const eventLabel = eventLabelFor(eventName);
    const groups = mergedHooksJson[eventName];
    groups.forEach((group, groupIndex) => {
      (group.hooks || []).forEach((handler, handlerIndex) => {
        if (!isYokiCodexCommand(handler.command)) return; // only trust our own handlers
        const key = hookStateKey(hooksJsonAbsPath, eventLabel, groupIndex, handlerIndex);
        const trustedHash = computeHandlerHash({ eventLabel, matcher: group.matcher, handler });
        entries.push({ key, trustedHash });
      });
    });
  }
  return entries;
}

module.exports = {
  KNOWN_EVENTS,
  isRunnerCommand,
  isYokiCodexCommand,
  groupIsOurs,
  translateMatcher,
  translateCommand,
  buildGeneratedGroups,
  mergeHooksJson,
  collectHookStateEntries,
};
