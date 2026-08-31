'use strict';

const path = require('path');

/**
 * Harness payload normalizer.
 *
 * Claude Code's hook stdin schema (`session_id`, `transcript_path`, `cwd`,
 * `hook_event_name`, `tool_name`, `tool_input`, ...) is the shape every yoki
 * hook script is written against. Codex CLI and omp speak their own event
 * shapes on their own hook/extension surfaces. `normalizePayload` translates
 * a raw event from either into the Claude shape so the same hook scripts run
 * unmodified under every harness.
 *
 * Facts this file encodes are pinned to two spike reports: Codex CLI 0.147.0
 * hook stdin (`apply_patch` tool_input is patch text, not a path) and omp
 * 18.0.4 extension events (`pi.on('tool_call', ...)` etc., bridged through
 * an `{event, payload, ctx}` envelope). Do not "improve" the mapping without
 * a new spike backing the change — these are observed facts, not guesses.
 */

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/**
 * Codex's `apply_patch` tool_input is the *entire* patch text, e.g.:
 *   "*** Begin Patch\n*** Add File: a.txt\n+alpha\n*** End Patch"
 * Split it into per-file sections and translate each into the Claude-shaped
 * tool call a hook would expect for that operation.
 */
function parseApplyPatch(patchText, cwd) {
  const lines = typeof patchText === 'string' ? patchText.split('\n') : [];
  const headerRe = /^\*\*\* (Add File|Update File|Delete File): (.+)$/;
  const sections = [];
  let current = null;

  for (const line of lines) {
    const header = headerRe.exec(line);
    if (header) {
      if (current) sections.push(current);
      current = { kind: header[1], path: header[2].trim(), lines: [] };
      continue;
    }
    if (line === '*** Begin Patch' || line === '*** End Patch') {
      if (current) {
        sections.push(current);
        current = null;
      }
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);

  return sections.map((section) => {
    const absPath = resolveCodexPath(section.path, cwd);
    if (section.kind === 'Add File') {
      const content = section.lines
        .filter((l) => l.startsWith('+'))
        .map((l) => l.slice(1))
        .join('\n');
      return { tool_name: 'Write', tool_input: { file_path: absPath, content } };
    }
    if (section.kind === 'Update File') {
      return { tool_name: 'Edit', tool_input: { file_path: absPath } };
    }
    // Delete File. The synthetic command exists so Bash guards can tokenize
    // it, so it has to be a command a shell would actually parse the way the
    // patch means: a path with a space or a metacharacter must stay one
    // argument, not become two words or a substitution.
    return { tool_name: 'Bash', tool_input: { command: `rm ${shellQuote(absPath)}` } };
  });
}

/** POSIX single-quoting: everything inside is literal, and an embedded
 *  single quote is closed, escaped and reopened ('\'' — the standard idiom). */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolveCodexPath(p, cwd) {
  if (path.isAbsolute(p)) return p;
  if (typeof cwd === 'string' && cwd.length > 0) return path.resolve(cwd, p);
  return p;
}

/** One normalized payload per file for a multi-file patch; a single object
 *  when only one file is touched. An empty list would mean "this tool call
 *  reaches no hook at all", so `meta.emptyFanout` marks it for the runners —
 *  the tool-call paths below never produce one (they fall back to a
 *  conservative single payload instead). */
function buildFanout(payloads, harness) {
  if (payloads.length === 1) {
    return { payload: payloads[0], meta: { harness } };
  }
  const meta = { harness, payloads };
  if (payloads.length === 0) meta.emptyFanout = true;
  return { payload: null, meta };
}

// A patch body the parser did not recognize must not become zero payloads:
// zero payloads means no guard hook ever sees the tool call, and both runners
// read that as "allow". Hand the hooks the call as it actually arrived
// instead — same tool name, raw input — so a guard matching on tool_name
// (Bash, apply_patch, edit) still gets its say.
function warnUnparsedToolInput(harness, toolName) {
  process.stderr.write(
    `[harness/payload] ${harness}: could not extract any file from ${toolName} input; ` +
      'passing the raw tool call to the hooks unchanged\n'
  );
}

function normalizeCodex(raw) {
  if (!raw || typeof raw !== 'object') {
    return { payload: raw, meta: { harness: 'codex' } };
  }

  // SubagentStop carries the sub-agent's rollout under `agent_transcript_path`
  // while `transcript_path` is the *parent's* file; hooks care about the
  // transcript the stop actually happened in.
  if (raw.hook_event_name === 'SubagentStop' && typeof raw.agent_transcript_path === 'string') {
    const mapped = Object.assign({}, raw, { transcript_path: raw.agent_transcript_path });
    delete mapped.agent_transcript_path;
    return { payload: mapped, meta: { harness: 'codex' } };
  }

  if (typeof raw.tool_name !== 'string') {
    // SessionStart, UserPromptSubmit, Stop, SessionEnd, SubagentStart: fields
    // already match Claude's schema verbatim.
    return { payload: Object.assign({}, raw), meta: { harness: 'codex' } };
  }

  const toolName = raw.tool_name;

  if (toolName === 'Bash') {
    return { payload: Object.assign({}, raw), meta: { harness: 'codex' } };
  }

  if (toolName === 'apply_patch') {
    const patchText =
      raw.tool_input && typeof raw.tool_input.command === 'string' ? raw.tool_input.command : '';
    const sections = parseApplyPatch(patchText, raw.cwd);
    if (sections.length === 0) {
      warnUnparsedToolInput('codex', 'apply_patch');
      return { payload: Object.assign({}, raw), meta: { harness: 'codex' } };
    }
    const rest = Object.assign({}, raw);
    delete rest.tool_name;
    delete rest.tool_input;
    const payloads = sections.map((s) =>
      Object.assign({}, rest, { tool_name: s.tool_name, tool_input: s.tool_input })
    );
    return buildFanout(payloads, 'codex');
  }

  if (toolName === 'collaborationspawn_agent' || toolName === 'spawn_agent') {
    return { payload: Object.assign({}, raw, { tool_name: 'Task' }), meta: { harness: 'codex' } };
  }

  if (toolName === 'collaborationwait_agent' || toolName === 'wait_agent') {
    return { payload: Object.assign({}, raw), meta: { harness: 'codex' } };
  }

  // Unknown tool: pass through unchanged rather than guess at a mapping.
  return { payload: Object.assign({}, raw), meta: { harness: 'codex' } };
}

// ---------------------------------------------------------------------------
// omp
// ---------------------------------------------------------------------------

const OMP_EVENT_MAP = {
  session_start: 'SessionStart',
  before_agent_start: 'UserPromptSubmit',
  tool_call: 'PreToolUse',
  tool_result: 'PostToolUse',
  session_before_compact: 'PreCompact',
  session_stop: 'Stop',
  session_shutdown: 'SessionEnd',
  tool_approval_requested: 'Notification',
};

const OMP_TOOL_NAME_MAP = {
  bash: 'Bash',
  write: 'Write',
  read: 'Read',
  glob: 'Glob',
  grep: 'Grep',
  ls: 'LS',
  task: 'Task',
};

/** omp's edit tool consumes hashline patches (`[PATH#TAG]` sections) or, on
 *  the apply_patch contract, `*** Update File:` envelopes. This is the sole
 *  source of truth for that parse: the omp extension
 *  (domains/dev/config/omp/extensions/yoki-bridge.ts) deliberately
 *  reimplements nothing and delegates every tool-call translation here. */
function ompEditPaths(input) {
  if (typeof input.path === 'string') return [input.path];
  const text = typeof input.input === 'string' ? input.input : '';
  const paths = new Set();
  for (const m of text.matchAll(/^\[([^\]#\n]+)#[0-9A-Fa-f]{4}\]/gm)) paths.add(m[1]);
  for (const m of text.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) paths.add(m[1].trim());
  return [...paths];
}

function mapOmpTool(toolName, input) {
  const safeInput = input && typeof input === 'object' ? input : {};

  if (toolName === 'bash') {
    return [{ tool_name: 'Bash', tool_input: { command: safeInput.command } }];
  }
  if (toolName === 'write') {
    return [{ tool_name: 'Write', tool_input: { file_path: safeInput.path, content: safeInput.content } }];
  }
  if (toolName === 'edit' || toolName === 'apply_patch') {
    const paths = ompEditPaths(safeInput);
    if (paths.length === 0) {
      warnUnparsedToolInput('omp', toolName);
      return [{ tool_name: toolName, tool_input: safeInput }];
    }
    return paths.map((p) => ({ tool_name: 'Edit', tool_input: { file_path: p } }));
  }
  if (Object.prototype.hasOwnProperty.call(OMP_TOOL_NAME_MAP, toolName)) {
    return [{ tool_name: OMP_TOOL_NAME_MAP[toolName], tool_input: safeInput }];
  }
  // anything else -> tool_name unchanged
  return [{ tool_name: toolName, tool_input: safeInput }];
}

function ompCommon(raw) {
  const ctx = raw.ctx && typeof raw.ctx === 'object' ? raw.ctx : {};
  return {
    session_id: ctx.session_id,
    cwd: ctx.cwd,
    transcript_path: ctx.session_file,
    model: ctx.model,
  };
}

function normalizeOmp(raw) {
  if (!raw || typeof raw !== 'object') {
    return { payload: raw, meta: { harness: 'omp' } };
  }

  const event = raw.event;
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  const common = ompCommon(raw);
  const hookEventName = OMP_EVENT_MAP[event] || event;

  switch (event) {
    case 'session_start':
    case 'session_shutdown':
      return {
        payload: Object.assign({}, common, { hook_event_name: hookEventName }),
        meta: { harness: 'omp' },
      };

    case 'before_agent_start':
      return {
        payload: Object.assign({}, common, { hook_event_name: hookEventName, prompt: payload.prompt }),
        meta: { harness: 'omp' },
      };

    case 'tool_call':
    case 'tool_result': {
      const mapped = mapOmpTool(payload.toolName, payload.input);
      const rest = Object.assign({}, payload);
      delete rest.toolName;
      delete rest.input;
      const base = Object.assign({}, common, { hook_event_name: hookEventName }, rest);
      if (event === 'tool_result') {
        base.tool_response = payload.content;
        delete base.content;
      }
      const built = mapped.map((m) =>
        Object.assign({}, base, { tool_name: m.tool_name, tool_input: m.tool_input })
      );
      return buildFanout(built, 'omp');
    }

    case 'session_before_compact':
      return {
        payload: Object.assign({}, common, {
          hook_event_name: hookEventName,
          preparation: payload.preparation,
          branchEntries: payload.branchEntries,
          customInstructions: payload.customInstructions,
        }),
        meta: { harness: 'omp' },
      };

    case 'session_stop':
      return {
        payload: Object.assign({}, common, {
          hook_event_name: hookEventName,
          turn_id: payload.turn_id,
          last_assistant_message: payload.last_assistant_message,
          stop_hook_active: payload.stop_hook_active,
        }),
        meta: { harness: 'omp' },
      };

    case 'tool_approval_requested':
      return {
        payload: Object.assign({}, common, {
          hook_event_name: hookEventName,
          notification_type: 'permission_prompt',
          tool_name: payload.toolName,
          reason: payload.reason,
          approvalMode: payload.approvalMode,
        }),
        meta: { harness: 'omp' },
      };

    default:
      // Unrecognized event: pass the payload fields through under the
      // (unmapped) event name rather than drop them.
      return {
        payload: Object.assign({}, common, { hook_event_name: hookEventName }, payload),
        meta: { harness: 'omp' },
      };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * normalizePayload(raw, harness) -> {payload, meta}
 *
 * - harness 'claude': input returned unchanged (identity).
 * - harness 'codex' | 'omp': translated into Claude's hook stdin shape.
 *
 * `payload` is `null` when one raw event fans out into several Claude-shaped
 * tool calls (a multi-file Codex apply_patch, or an omp hashline patch that
 * touches several paths) — the caller reads `meta.payloads` (an array, one
 * entry per file) and runs the hooks once per entry, combining verdicts
 * (first deny wins).
 */
function normalizePayload(raw, harness) {
  if (harness === 'claude') {
    return { payload: raw, meta: { harness: 'claude' } };
  }
  if (harness === 'codex') {
    return normalizeCodex(raw);
  }
  if (harness === 'omp') {
    return normalizeOmp(raw);
  }
  throw new Error(`normalizePayload: unknown harness "${harness}"`);
}

module.exports = {
  normalizePayload,
};
