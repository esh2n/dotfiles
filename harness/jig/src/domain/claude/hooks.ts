/**
 * Claude Code's `hooks` block: six events, one hook each.
 *
 * The roster is fixed by `rules/decisions/2026-10-23-claude-hooks-six-events.md`
 * (the five of `2026-09-22-hooks-five-events.md` plus SubagentStop, for the
 * findings check of `2026-10-23-findings-verification-check.md`) and
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md` (which of them
 * formats and which gates). It is a closed list on purpose: the thing this
 * replaces had 33 entries across 7 events, and a generator that could be
 * asked for a seventh would grow back into that.
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

/** The six events, in the order they are written into settings.json. */
export const CLAUDE_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SubagentStop",
  "Stop",
] as const;

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

/**
 * The MCP tools on a shared place others see, which the guard's
 * `ask-mcp-shared-write` rule judges (`rules/decisions/2026-10-19-pstack-precedence-table.md`):
 * every Notion tool, from the house `notion-mcp` server and from Claude
 * Code's claude.ai connector. A hook only judges what its matcher names, so
 * without this tail the rule would never be asked. The matcher routes every
 * Notion tool and the rule tells reads from writes: Codex compiles matchers
 * with Rust's `regex` crate, which has no lookaround, so the read exclusion
 * cannot live here. Fail-safe either way: a tool Notion adds later reaches
 * the guard and asks until the rule names it a read.
 */

export const SHARED_WRITE_MCP_MATCHER = "mcp__(?:claude_ai_Notion|notion-mcp)__notion-[a-z-]+";

/**
 * The tools the guard is asked about. Read/Write/Edit/MultiEdit and Bash are
 * the harness's own; the serena tails are the MCP calls that *write* — a
 * symbol replacement is an edit that would otherwise reach disk unjudged;
 * the Notion tail is every Notion tool (above). Read-only MCP tools
 * stay unmatched and untaxed.
 */
const GUARD_MATCHER = [
  "Bash|Read|Write|Edit|MultiEdit|WebFetch",
  "mcp__serena__(replace_symbol_body|insert_after_symbol|insert_before_symbol|replace_content|safe_delete_symbol)",
  SHARED_WRITE_MCP_MATCHER,
].join("|");

/**
 * What the PostToolUse hook is fired on. The formatter acts on the edit tools
 * only, never Bash: the decision is "編集したファイルだけ" — the hook formats
 * the file the tool named. `Skill` and `SubagentHandback` are there for the
 * findings check's record (which skill was loaded; a subagent's report in
 * auto mode), and the formatter ignores them.
 */
const POST_TOOL_MATCHER = "Write|Edit|MultiEdit|Skill|SubagentHandback";

interface HookSpec {
  readonly event: ClaudeHookEvent;
  /** Omitted for the events that do not match tools (Claude Code ignores it there). */
  readonly matcher?: string;
  readonly subcommand: string;
  readonly timeout: number;
  /**
   * The command can never stop what it hooks. On SubagentStop an exit 2 keeps the
   * subagent running, and a checkout older than the roster — a revert before `jig apply`
   * runs again — answers an unknown subcommand with exit 2.
   */
  readonly neverBlocks?: boolean;
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
 * - the SubagentStop record is one append, but a swarm finishing at once starts
 *   several bun processes together, and a killed record is a report the gate
 *   never sees; 15s leaves that room;
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
    matcher: POST_TOOL_MATCHER,
    subcommand: "hooks post-tool-use-format",
    timeout: 30,
    purpose: "format the edited file only, silently; record Skill calls and subagent reports",
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
    event: "SubagentStop",
    subcommand: "hooks subagent-stop",
    timeout: 15,
    neverBlocks: true,
    purpose: "record the finished subagent's type and Findings line (never blocks)",
  },
  {
    event: "Stop",
    subcommand: "hooks stop-gate",
    timeout: 300,
    purpose: "findings check, then typecheck/lint gate once per turn (stop_hook_active)",
  },
];

export interface ClaudeHookPaths {
  /** Absolute path to the bun binary the hook is executed with. */
  readonly bun: string;
  /** Absolute path to `src/cli/jig.ts`. */
  readonly jig: string;
}

/** The full command line one spec becomes — exported so the dry-run can list it. */
export function hookCommand(paths: ClaudeHookPaths, spec: HookSpec): string {
  const line = `${paths.bun} ${paths.jig} ${spec.subcommand} --harness claude`;
  return spec.neverBlocks === true ? `${line} || true` : line;
}

/**
 * The `hooks` value for settings.json. Replaces whatever was there: the six
 * are the whole roster, so merging into the previous array would keep exactly
 * the entries this decision retires.
 */
export function buildClaudeHooks(paths: ClaudeHookPaths): JsonObject {
  const out: Record<string, Json> = {};
  for (const spec of CLAUDE_HOOKS) {
    out[spec.event] = [
      {
        ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
        hooks: [{ type: "command", command: hookCommand(paths, spec), timeout: spec.timeout }],
      },
    ];
  }
  return out;
}

export type { HookSpec };
