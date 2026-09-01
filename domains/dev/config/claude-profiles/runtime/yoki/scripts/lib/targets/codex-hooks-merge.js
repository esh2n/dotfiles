'use strict';

/**
 * Builds `~/.codex/hooks.json` from the layered Claude settings files and
 * merges it into whatever is already at the destination, keeping foreign
 * groups (herdr, or any other tool's) byte-for-byte in place — spike
 * S1+S2 §3 "Recommendation".
 *
 * The file is written in the shape Codex reads: the event map WRAPPED under
 * a top-level `hooks` key (`{"hooks": {"<Event>": [{matcher?, hooks: […]}]}}`).
 * `buildGeneratedGroups` still works in the flat `<Event> -> groups` map
 * internally — the wrap happens once, in `mergeHooksJson`, which is also
 * where a pre-wrap flat file on disk is read and migrated.
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
 * a layer declares them, since the TUI does reach them). PostCompact is
 * included alongside PreCompact (T18) so a future TUI-reachable PostCompact
 * hook can pick up whatever pre-compact.js queued into
 * ../pending-context.js the moment compaction actually finishes, instead of
 * waiting for the next UserPromptSubmit. `Interrupt` (T32) only exists on
 * Codex >= 0.150.0 — a settings-layer hook declared on it is still
 * recognized and translated here, but `../codex.js`'s `plan()` additionally
 * gates it against the installed `codex --version` and drops it (with a
 * warning) on an older CLI, since an unrecognized event key in hooks.json
 * would otherwise be silently ignored by Codex itself rather than reported. */
const KNOWN_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Interrupt',
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
 * True for the shape Codex ACTUALLY reads: the event map nested under a
 * top-level `hooks` key. Verified against the real, already-trusted
 * `~/.codex/hooks.json` on this machine (a herdr `SessionStart` group under
 * `{"hooks": {...}}`, whose `[hooks.state]` entry Codex itself wrote) — a
 * flat `{"<Event>": [...]}` file parses fine but Codex finds no hooks in it
 * and silently runs none, which is exactly the failure the trust-hash
 * machinery exists to prevent. `doctor.js` fails on the flat shape rather
 * than accepting it.
 *
 * @param {*} parsed parsed hooks.json content
 */
function isWrappedHooksJson(parsed) {
  return Boolean(
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
    parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)
  );
}

/**
 * The `<Event> -> groups` map inside a hooks.json, whichever shape the file
 * is in. `Event` names never collide with the `hooks` wrapper key
 * (KNOWN_EVENTS has no `hooks` entry), so the two shapes are unambiguous.
 *
 * @param {*} parsed parsed hooks.json content (wrapped or flat)
 * @returns {Record<string, Array<object>>}
 */
function hookEventsOf(parsed) {
  if (isWrappedHooksJson(parsed)) return parsed.hooks;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return {};
}

/**
 * Merges `generated` groups into `existing` hooks.json content: within each
 * event, foreign groups (anything not recognizably ours) keep their
 * position and order; our own previously-generated groups are dropped and
 * replaced by the freshly generated ones, appended at the end.
 *
 * The result is always in the WRAPPED shape Codex itself writes and reads —
 * `{"hooks": {"<Event>": [{matcher?, hooks: […]}]}}` — see
 * `isWrappedHooksJson` for why. A flat `existing` (what yoki wrote before
 * this was fixed) is still read correctly, so the first `apply` after this
 * change migrates the file in place instead of duplicating every group.
 * Foreign TOP-LEVEL keys of a wrapped file (anything Codex may add beside
 * `hooks`) are preserved, for the same reason foreign groups are.
 *
 * @param {object} existing parsed existing hooks.json (or `{}`)
 * @param {Record<string, Array<object>>} generated from buildGeneratedGroups
 * @returns {{hooks: Record<string, Array<object>>}} the merged hooks.json content
 */
function mergeHooksJson(existing, generated) {
  const existingEvents = hookEventsOf(existing) || {};
  const extras = isWrappedHooksJson(existing)
    ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== 'hooks'))
    : {};

  const mergedEvents = {};
  const eventNames = new Set([...Object.keys(existingEvents), ...Object.keys(generated)]);

  for (const eventName of eventNames) {
    const existingGroups = Array.isArray(existingEvents[eventName]) ? existingEvents[eventName] : [];
    const foreignGroups = existingGroups.filter(g => !groupIsOurs(g));
    const newGroups = generated[eventName] || [];
    const finalGroups = [...foreignGroups, ...newGroups];
    if (finalGroups.length > 0) mergedEvents[eventName] = finalGroups;
  }

  return { hooks: mergedEvents, ...extras };
}

/**
 * Derives `[hooks.state]` trust entries from the FINAL merged hooks.json —
 * positional indices are read off the merged content so a foreign group
 * ahead of ours in the same event correctly shifts our indices (S1+S2 §2.2,
 * §2.3 point 4a in the S1+S2 recommendation).
 *
 * Indices are read off the WRAPPED content (`mergeHooksJson`'s output), the
 * same bytes Codex itself indexes — the group/handler positions are
 * identical either way, but taking them from the wrapped object is what
 * keeps "what we hash" and "what we write" the same object rather than two
 * shapes that happen to agree. A flat map is still accepted so a caller
 * holding a pre-wrap file gets real entries instead of a silent zero.
 *
 * @param {{hooks?: Record<string, Array<object>>}|Record<string, Array<object>>} mergedHooksJson
 * @param {string} hooksJsonAbsPath absolute path of the destination hooks.json
 * @returns {Array<{key: string, trustedHash: string}>}
 */
function collectHookStateEntries(mergedHooksJson, hooksJsonAbsPath) {
  const entries = [];
  const events = hookEventsOf(mergedHooksJson);
  for (const eventName of Object.keys(events)) {
    const eventLabel = eventLabelFor(eventName);
    const groups = events[eventName];
    if (!Array.isArray(groups)) continue;
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
  isWrappedHooksJson,
  hookEventsOf,
  mergeHooksJson,
  collectHookStateEntries,
};
