'use strict';

/**
 * Builds `~/.codex/hooks.json` from the layered Claude settings files and
 * merges it into whatever is already at the destination, keeping foreign
 * groups (herdr, or any other tool's) byte-for-byte in place — spike
 * S1+S2 §3 "Recommendation".
 *
 * Hook commands that already go through `run-with-flags.js` or
 * `run-bash-hook.js` are portable as-is: they are the commands whose payload
 * gets normalized into the shape the hook script actually expects (see
 * ../harness/payload.js).
 *
 * The personal layer's bash-wrapper guards (`bash -c 'h=~/.claude/hooks/
 * git-guard.sh; bash -n "$h" && exec bash "$h"'` — see
 * personal/settings.personal.json) are ALSO translated, by rewriting them
 * into the equivalent `run-bash-hook.js --harness codex <hook.sh>` call,
 * which performs the same syntax gate plus the payload/response translation
 * Codex needs. Dropping them (the behaviour before bash-wrapper-hook.js
 * existed) silently removed git-guard.sh / unattended-guard.sh from the
 * Codex target — a protection downgrade relative to Claude Code.
 *
 * Anything else (the `osascript` notification hooks, a future ad-hoc
 * one-liner) is reported in the plan's `skipped` list with a reason — never
 * silently dropped, and never guessed at and shipped broken.
 */

const path = require('path');

const { eventLabelFor, computeHandlerHash, hookStateKey } = require('./codex-trust');
const { parseBashWrapperCommand } = require('./bash-wrapper-hook');

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

/** Same `"${YOKI_NODE:-node}" "<abs script>"` shape core/settings.layer.json
 * uses for every runner hook, so the generated command is indistinguishable
 * (to isYokiCodexCommand and to a human reading hooks.json) from one a
 * settings layer wrote itself. */
function runBashHookCommand(yokiRoot, script, args) {
  const runner = path.join(yokiRoot, 'scripts', 'hooks', 'run-bash-hook.js');
  const tail = args && args.length > 0 ? ` ${args.map(a => `"${a}"`).join(' ')}` : '';
  return `"\${YOKI_NODE:-node}" "${runner}" --harness codex "${script}"${tail}`;
}

/**
 * @param {Array<{event: string, matcher: string, hooks: Array<object>}>} rawGroups
 *   flattened groups from every layer's settings `hooks[event]`, in layer order
 * @param {string} eventName Claude event name (also the Codex event name)
 * @param {{yokiRoot?: string, home?: string}} [options] `yokiRoot` locates
 *   run-bash-hook.js for a translated bash-wrapper guard; without it those
 *   guards cannot be rewritten and are reported as skipped instead.
 * @returns {{groups: Array<object>, warnings: string[],
 *   skipped: Array<{target:string, event:string, matcher:string,
 *     command:string, reason:string}>}}
 */
function translateEventGroups(eventName, rawGroups, options = {}) {
  const groups = [];
  const warnings = [];
  const skipped = [];

  const skip = (matcher, command, reason) => {
    skipped.push({
      target: 'codex',
      event: eventName,
      matcher: String(matcher === undefined || matcher === null ? '' : matcher),
      command: String(command === undefined || command === null ? '' : command),
      reason,
    });
    warnings.push(`codex: ${eventName}/${matcher} — skipped: ${reason}`);
  };

  for (const group of rawGroups) {
    const groupHandlers = Array.isArray(group.hooks) ? group.hooks : [];
    const matcher = translateMatcher(group.matcher);
    if (matcher === null) {
      const reason = `${eventName} matcher "${group.matcher}" has no Codex equivalent (no Workflow tool)`;
      for (const handler of groupHandlers) skip(group.matcher, handler && handler.command, reason);
      continue;
    }

    const hooks = [];
    for (const handler of groupHandlers) {
      let command = null;
      if (isRunnerCommand(handler.command)) {
        command = translateCommand(handler.command);
      } else {
        const wrapper = parseBashWrapperCommand(handler.command, options);
        if (wrapper && options.yokiRoot) {
          command = runBashHookCommand(options.yokiRoot, wrapper.script, wrapper.args);
        } else if (wrapper) {
          skip(group.matcher, handler.command, 'personal bash-wrapper guard cannot be rewritten: no YOKI_ROOT resolved for run-bash-hook.js');
          continue;
        }
      }

      if (command === null) {
        skip(
          group.matcher,
          handler.command,
          "command is neither a run-with-flags.js/run-bash-hook.js invocation nor the personal bash-wrapper form — not portable to Codex's payload shape"
        );
        continue;
      }

      const translated = { type: 'command', command: appendIfFlag(command, handler.if) };
      if (handler.async !== undefined) translated.async = handler.async;
      translated.timeout = eventName === 'SessionEnd' ? 3 : handler.timeout;
      if (translated.timeout === undefined) delete translated.timeout;
      hooks.push(translated);
    }

    if (hooks.length > 0) groups.push({ matcher, hooks });
  }

  return { groups, warnings, skipped };
}

/**
 * @param {Array<{hooks?: Record<string, Array<object>>}>} settingsLayers
 *   parsed settings.layer.json/settings.personal.json contents, in layer order
 * @param {{yokiRoot?: string, home?: string}} [options]
 * @returns {{generated: Record<string, Array<object>>, warnings: string[],
 *   skipped: Array<object>}}
 */
function buildGeneratedGroups(settingsLayers, options = {}) {
  const warnings = [];
  const skipped = [];
  const generated = {};

  const eventsSeen = new Set();
  for (const layer of settingsLayers) {
    for (const eventName of Object.keys((layer && layer.hooks) || {})) {
      eventsSeen.add(eventName);
    }
  }

  for (const eventName of eventsSeen) {
    const rawGroups = settingsLayers.flatMap(layer => ((layer && layer.hooks && layer.hooks[eventName]) || []));

    if (!KNOWN_EVENTS.has(eventName)) {
      const reason = eventName === 'Notification'
        ? 'Notification is not a Codex hook event (see codex-notify.js / config.toml `notify`)'
        : `hook event "${eventName}" has no known Codex equivalent`;
      warnings.push(`codex: ${reason} — skipped`);
      for (const group of rawGroups) {
        for (const handler of Array.isArray(group.hooks) ? group.hooks : []) {
          skipped.push({
            target: 'codex',
            event: eventName,
            matcher: String(group.matcher === undefined || group.matcher === null ? '' : group.matcher),
            command: String((handler && handler.command) || ''),
            reason,
          });
        }
      }
      continue;
    }

    const { groups, warnings: groupWarnings, skipped: groupSkipped } = translateEventGroups(eventName, rawGroups, options);
    warnings.push(...groupWarnings);
    skipped.push(...groupSkipped);
    if (groups.length > 0) generated[eventName] = groups;
  }

  return { generated, warnings, skipped };
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
  runBashHookCommand,
  isRunnerCommand,
  isYokiCodexCommand,
  groupIsOurs,
  translateMatcher,
  translateCommand,
  buildGeneratedGroups,
  mergeHooksJson,
  collectHookStateEntries,
};
