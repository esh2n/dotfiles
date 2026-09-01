'use strict';

/**
 * Builds `~/.omp/agent/yoki-hooks.json` from the layered Claude settings
 * files, in the `{event: [{id, kind, script, profiles?, timeout?, if?,
 * matcher?}]}` shape `extensions/yoki-bridge.ts` (task T6) already reads
 * (`HookSpec` there). Unlike Codex's `hooks.json` (codex-hooks-merge.js),
 * this file has no foreign owner to preserve alongside ours — it is yoki's
 * own manifest — so it is written wholesale on every run rather than merged.
 *
 * Hook commands that already go through `run-with-flags.js` or
 * `run-bash-hook.js` are portable as-is (same rule as Codex): they are the
 * commands whose payload gets normalized into the shape the hook script
 * actually expects.
 *
 * The personal layer's bash-wrapper guards (`bash -c 'h=~/.claude/hooks/
 * git-guard.sh; bash -n "$h" && exec bash "$h"'` — see
 * personal/settings.personal.json) are ALSO translated, into
 * `{kind:'bash', script, args}` specs, which yoki-bridge.ts dispatches
 * through `run-bash-hook.js --harness omp`. Dropping them (the behaviour
 * before bash-wrapper-hook.js existed) silently removed git-guard.sh /
 * unattended-guard.sh from the omp target — a protection downgrade relative
 * to Claude Code, not a cosmetic gap.
 *
 * Anything else (the `osascript` notification hooks, a future ad-hoc
 * one-liner) is reported in the plan's `skipped` list with a reason — never
 * silently dropped, and never guessed at and shipped broken.
 *
 * Event mapping (per task spec):
 *   PreToolUse -> tool_call            PostToolUse -> tool_result
 *   Stop -> session_stop               SessionStart -> session_start
 *   UserPromptSubmit -> before_agent_start
 *   PreCompact -> session_before_compact
 *   SessionEnd -> session_shutdown
 *   Notification(matcher:"permission_prompt") -> tool_approval_requested
 *     (every other Notification matcher, e.g. "idle_prompt", has no omp
 *     event and is skipped with a warning)
 *   any group whose matcher is "Workflow" -> skipped (no Workflow tool on
 *     omp — translateMatcher('Workflow') already returns null since
 *     "Workflow" isn't a Claude tool name omp-tool-names.js knows)
 *
 * `matcher`/`timeout` (in ms — omp's `ctx.setTimeout` wants milliseconds,
 * unlike Claude/Codex's seconds-based `timeout` field) and `if` are not
 * consumed by yoki-bridge.ts yet (dispatch() runs every hook registered for
 * an event unconditionally); they are still emitted here per the T10 spec
 * so a later bridge update can start honoring them without another
 * generator change, exactly like the already-inert `if` field.
 */

const path = require('path');
const { translateMatcher } = require('./omp-tool-names');
const { parseBashWrapperCommand } = require('./bash-wrapper-hook');

/** Claude event name -> omp event name, for every event that has one. */
const EVENT_MAP = new Map([
  ['PreToolUse', 'tool_call'],
  ['PostToolUse', 'tool_result'],
  ['Stop', 'session_stop'],
  ['SessionStart', 'session_start'],
  ['UserPromptSubmit', 'before_agent_start'],
  ['PreCompact', 'session_before_compact'],
  ['SessionEnd', 'session_shutdown'],
]);

/** Events whose groups carry a per-tool matcher worth translating (the
 * tool_call/tool_result pair) — every other mapped event is session-scoped,
 * so no `matcher` field is emitted for it. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

const RUN_WITH_FLAGS_RE = /run-with-flags\.js/;
const RUN_BASH_HOOK_RE = /run-bash-hook\.js/;

function isRunnerCommand(command) {
  return typeof command === 'string' && (RUN_WITH_FLAGS_RE.test(command) || RUN_BASH_HOOK_RE.test(command));
}

/** Every double-quoted token in a command string, in order. Every
 * run-with-flags.js/run-bash-hook.js call this repo's settings.layer.json
 * builds uses simple double-quoted, space-separated tokens, so a full shell
 * tokenizer is unnecessary (see core/settings.layer.json). */
function quotedTokens(command) {
  const tokens = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(command))) tokens.push(m[1]);
  return tokens;
}

/**
 * @param {string} command
 * @param {{home?: string}} [options] `home` expands the wrapper's `~/…`
 *   hook path (test seam; defaults to the real home dir).
 * @returns {{kind:'js', id:string, script:string, profiles?:string[]}|
 *   {kind:'bash', id:string, script:string, args?:string[]}|null} null when
 *   `command` is neither a run-with-flags.js/run-bash-hook.js invocation nor
 *   the personal layer's `bash -c '…exec bash "$h"…'` wrapper.
 */
function parseRunnerCommand(command, options = {}) {
  const tokens = quotedTokens(command);

  if (RUN_WITH_FLAGS_RE.test(command)) {
    const idx = tokens.findIndex(t => RUN_WITH_FLAGS_RE.test(t));
    const hookId = tokens[idx + 1];
    const script = tokens[idx + 2];
    if (!hookId || !script) return null;
    const spec = { kind: 'js', id: hookId, script };
    const profilesCsv = tokens[idx + 3];
    if (profilesCsv) {
      const profiles = profilesCsv.split(',').map(s => s.trim()).filter(Boolean);
      if (profiles.length > 0) spec.profiles = profiles;
    }
    return spec;
  }

  if (RUN_BASH_HOOK_RE.test(command)) {
    const idx = tokens.findIndex(t => RUN_BASH_HOOK_RE.test(t));
    const script = tokens[idx + 1];
    if (!script) return null;
    return { kind: 'bash', id: path.basename(script).replace(/\.sh$/, ''), script };
  }

  // The personal layer's bash wrapper: run the same .sh through
  // run-bash-hook.js instead of dropping the guard entirely.
  const wrapper = parseBashWrapperCommand(command, options);
  if (wrapper) {
    const spec = { kind: 'bash', id: wrapper.name, script: wrapper.script };
    if (wrapper.args.length > 0) spec.args = wrapper.args;
    return spec;
  }

  return null;
}

/** Seconds (Claude/Codex hook `timeout`) -> milliseconds (omp
 * `ctx.setTimeout`) — see yoki-bridge.ts's `DEFAULT_TIMEOUT_MS = 5000`
 * ("Matches the 5s timeout the shell hooks are registered with"). */
function timeoutMs(handlerTimeoutSeconds) {
  if (typeof handlerTimeoutSeconds !== 'number' || !Number.isFinite(handlerTimeoutSeconds) || handlerTimeoutSeconds <= 0) {
    return undefined;
  }
  return Math.round(handlerTimeoutSeconds * 1000);
}

/**
 * @param {string} claudeEventName
 * @param {Array<{matcher:string, hooks:Array<object>}>} rawGroups flattened
 *   groups from every layer's settings `hooks[claudeEventName]`, layer order
 * @param {{home?: string}} [options] `home` expands a bash-wrapper hook's
 *   leading `~/` (test seam; defaults to the real home dir)
 * @returns {{specs: Array<object>, warnings: string[],
 *   skipped: Array<{target:string, event:string, matcher:string,
 *     command:string, reason:string}>}}
 */
function translateEventGroups(claudeEventName, rawGroups, options = {}) {
  const specs = [];
  const warnings = [];
  const skipped = [];
  const isToolEvent = TOOL_EVENTS.has(claudeEventName);

  const skip = (matcher, command, reason) => {
    skipped.push({
      target: 'omp',
      event: claudeEventName,
      matcher: String(matcher === undefined || matcher === null ? '' : matcher),
      command: String(command === undefined || command === null ? '' : command),
      reason,
    });
    warnings.push(`omp: ${claudeEventName}/${matcher} — skipped: ${reason}`);
  };

  for (const group of rawGroups) {
    const groupHandlers = Array.isArray(group.hooks) ? group.hooks : [];
    let matcher;
    if (claudeEventName === 'Notification') {
      if (group.matcher !== 'permission_prompt') {
        const reason = `Notification matcher "${group.matcher}" has no omp event equivalent (only "permission_prompt" -> tool_approval_requested)`;
        for (const handler of groupHandlers) skip(group.matcher, handler && handler.command, reason);
        continue;
      }
    } else if (isToolEvent) {
      matcher = translateMatcher(group.matcher);
      if (matcher === null) {
        const reason = `${claudeEventName} matcher "${group.matcher}" has no omp tool equivalent`;
        for (const handler of groupHandlers) skip(group.matcher, handler && handler.command, reason);
        continue;
      }
    }

    for (const handler of groupHandlers) {
      const parsed = parseRunnerCommand(handler.command, options);
      if (!parsed) {
        skip(
          group.matcher,
          handler.command,
          "command is neither a run-with-flags.js/run-bash-hook.js invocation nor the personal bash-wrapper form — not portable to omp's payload shape"
        );
        continue;
      }

      const spec = { ...parsed };
      if (matcher !== undefined) spec.matcher = matcher;
      const ms = timeoutMs(handler.timeout);
      if (ms !== undefined) spec.timeout = ms;
      if (typeof handler.if === 'string' && handler.if) spec.if = handler.if;
      specs.push(spec);
    }
  }

  return { specs, warnings, skipped };
}

/**
 * @param {Array<{hooks?: Record<string, Array<object>>}>} settingsLayers
 *   parsed settings.layer.json/settings.personal.json contents, layer order
 * @param {{home?: string}} [options]
 * @returns {{generated: Record<string, Array<object>>, warnings: string[],
 *   skipped: Array<object>}} `skipped` lists every hook command that could
 *   NOT be translated, so gen.js can print it — a dropped guard must stay
 *   visible in the plan output rather than disappearing quietly.
 */
function buildYokiHooksJson(settingsLayers, options = {}) {
  const warnings = [];
  const skipped = [];
  const generated = {};

  const claudeEventsSeen = new Set();
  for (const layer of settingsLayers) {
    for (const eventName of Object.keys((layer && layer.hooks) || {})) claudeEventsSeen.add(eventName);
  }

  for (const claudeEventName of claudeEventsSeen) {
    const ompEventName = claudeEventName === 'Notification' ? 'tool_approval_requested' : EVENT_MAP.get(claudeEventName);
    const rawGroups = settingsLayers.flatMap(layer => ((layer && layer.hooks && layer.hooks[claudeEventName]) || []));

    if (!ompEventName) {
      const reason = `hook event "${claudeEventName}" has no known omp equivalent`;
      warnings.push(`omp: ${reason} — skipped`);
      for (const group of rawGroups) {
        for (const handler of Array.isArray(group.hooks) ? group.hooks : []) {
          skipped.push({
            target: 'omp',
            event: claudeEventName,
            matcher: String(group.matcher === undefined || group.matcher === null ? '' : group.matcher),
            command: String((handler && handler.command) || ''),
            reason,
          });
        }
      }
      continue;
    }

    const { specs, warnings: groupWarnings, skipped: groupSkipped } = translateEventGroups(claudeEventName, rawGroups, options);
    warnings.push(...groupWarnings);
    skipped.push(...groupSkipped);
    if (specs.length > 0) {
      generated[ompEventName] = [...(generated[ompEventName] || []), ...specs];
    }
  }

  return { generated, warnings, skipped };
}

module.exports = {
  EVENT_MAP,
  isRunnerCommand,
  parseRunnerCommand,
  timeoutMs,
  buildYokiHooksJson,
};
