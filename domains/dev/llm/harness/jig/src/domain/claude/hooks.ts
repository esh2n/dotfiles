/**
 * Claude Code's `hooks` block: five events, one hook each.
 *
 * The roster is fixed by `rules/decisions/2026-09-22-hooks-five-events.md`
 * ("フックは出来事ごとに一本、五本に畳む") and
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md` (which of them
 * formats and which gates). It is a closed list on purpose: the thing this
 * replaces had 33 entries across 7 events, and a generator that could be
 * asked for a sixth would grow back into that.
 *
 * Every command is an absolute bun path plus an absolute path to jig's
 * entrypoint. A hook runs in whatever environment Claude Code hands it, which
 * is not a login shell and promises nothing about PATH — the same reasoning
 * `cli/jig.ts`'s `codexRegistration` already applies to Codex. A hook that
 * cannot be resolved is worse than no hook, because it looks like one.
 *
 * Pure: the caller resolves the two paths and hands them in.
 */

import type { Json, JsonObject } from "../compose/merge";

/** The five events, in the order they are written into settings.json. */
export const CLAUDE_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "Stop",
] as const;

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

/**
 * The tools the guard is asked about. Read/Write/Edit/MultiEdit and Bash are
 * the harness's own; the serena tails are the MCP calls that *write* — a
 * symbol replacement is an edit that would otherwise reach disk unjudged.
 * Read-only MCP tools stay unmatched and untaxed.
 */
const GUARD_MATCHER =
  "Bash|Read|Write|Edit|MultiEdit|WebFetch" +
  "|mcp__serena__(replace_symbol_body|insert_after_symbol|insert_before_symbol|replace_content|safe_delete_symbol)";

/**
 * What the formatter is fired on: the edit tools only, never Bash. The
 * decision is "編集したファイルだけ" — the hook formats the file the tool
 * named, so a tool that names no file has nothing for it to do.
 */
const FORMAT_MATCHER = "Write|Edit|MultiEdit";

interface HookSpec {
  readonly event: ClaudeHookEvent;
  /** Omitted for the events that do not match tools (Claude Code ignores it there). */
  readonly matcher?: string;
  readonly subcommand: string;
  readonly timeout: number;
  /** One line, for the dry-run's hook listing. */
  readonly purpose: string;
}

/**
 * Timeouts are the cost ceiling of each hook, not a guess at its duration:
 *
 * - the guard is a loopback call to a judgment service that may be down, and
 *   10s is what the Codex registration already uses;
 * - the session record and the formatter are local work on one file;
 * - the router calls the judgment service once per turn;
 * - the gate runs a typecheck over a whole project, which is minutes on a
 *   cold cache. Claude Code kills the hook at the timeout, and a killed gate
 *   simply lets the turn end — the failure mode is "no backstop", not "stuck".
 */
export const CLAUDE_HOOKS: readonly HookSpec[] = [
  {
    event: "PreToolUse",
    matcher: GUARD_MATCHER,
    subcommand: "hooks pre-tool-use",
    timeout: 10,
    purpose: "guard: judge the call against policy/guard-rules.json",
  },
  {
    event: "PostToolUse",
    matcher: FORMAT_MATCHER,
    subcommand: "hooks post-tool-use-format",
    timeout: 30,
    purpose: "format the edited file only, silently",
  },
  {
    event: "UserPromptSubmit",
    subcommand: "hooks user-prompt-submit",
    timeout: 20,
    purpose: "skill selection for this turn (never blocks the prompt)",
  },
  {
    event: "SessionStart",
    subcommand: "hooks session-start",
    timeout: 5,
    purpose: "record this session's model (the only event that carries it)",
  },
  {
    event: "Stop",
    subcommand: "hooks stop-gate",
    timeout: 300,
    purpose: "typecheck/lint gate, once per turn, honouring stop_hook_active",
  },
];

export interface ClaudeHookPaths {
  /** Absolute path to the bun binary the hook is executed with. */
  readonly bun: string;
  /** Absolute path to `src/cli/jig.ts`. */
  readonly jig: string;
}

function command(paths: ClaudeHookPaths, subcommand: string): string {
  return `${paths.bun} ${paths.jig} ${subcommand} --harness claude`;
}

/** The full command line one spec becomes — exported so the dry-run can list it. */
export function hookCommand(paths: ClaudeHookPaths, spec: HookSpec): string {
  return command(paths, spec.subcommand);
}

/**
 * The `hooks` value for settings.json. Replaces whatever was there: the five
 * are the whole roster, so merging into the previous array would keep exactly
 * the entries this decision retires.
 */
export function buildClaudeHooks(paths: ClaudeHookPaths): JsonObject {
  const out: Record<string, Json> = {};
  for (const spec of CLAUDE_HOOKS) {
    out[spec.event] = [
      {
        ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
        hooks: [
          { type: "command", command: command(paths, spec.subcommand), timeout: spec.timeout },
        ],
      },
    ];
  }
  return out;
}

export type { HookSpec };
