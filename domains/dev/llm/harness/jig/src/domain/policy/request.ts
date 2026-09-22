/**
 * Normalization: one harness tool call becomes one request in the core's
 * vocabulary. This is the only place that knows `Bash` and `bash` and
 * `bash_background` are the same operation, that a path arrives as
 * `file_path` from Claude Code but `path` from pi's `str_replace_editor`,
 * and that codex hands over an argv array rather than a string.
 *
 * Nothing here judges. It reads the call, runs subject extraction for shell
 * commands, and hands the result to the evaluator.
 */

import type { HookProfile, ToolCall } from "../hooks/decision";
import { type Extraction, fromArgv, fromString } from "../subject";
import type { Action } from "./types";

/** Who is asking. Stamped by the adapter; no harness sends it on its own. */
export interface Principal {
  /** `claude`, `pi`, `dsh`, `codex`, or whatever the adapter names itself. */
  readonly harness: string;
  readonly profile: HookProfile;
  readonly sessionId?: string;
  readonly cwd?: string;
  /** The harness's own permission mode, when it reports one (Claude Code, codex). */
  readonly permissionMode?: string;
  /** For a subagent: the session it was delegated from (DSH reports this). */
  readonly parentSessionId?: string;
  /**
   * The model the calling session runs on, when it is known. No harness sends
   * it with a tool call: Claude Code carries `model` only on `SessionStart`
   * ("Only `SessionStart` hooks can receive a `model` field" —
   * https://code.claude.com/docs/en/hooks.md), so the adapter looks it up by
   * `sessionId` in the log that hook writes, and it is `undefined` whenever
   * the session was never recorded or the harness omitted the field.
   *
   * It is a fact about the caller, so it belongs here with the rest of them,
   * and it reaches the audit log for free (`AuditEntry` embeds the principal):
   * every judgment now says which model asked. The rules themselves cannot
   * match on it — `Rule` narrows by `profiles` and `principals` (harness
   * names) only — and deliberately so: nothing about the policy schema changed
   * to carry this.
   */
  readonly model?: string;
  /**
   * The harness's own id for this one tool call (`tool_use_id` on Claude Code
   * and codex, `toolCallId` on pi, `callId` on DSH). Stamped so the audit log
   * can be reconciled against the harness's own transcript — a call the
   * harness recorded but the audit did not is a call the guard never judged
   * (`jig report guard-coverage`).
   */
  readonly callId?: string;
}

export type Request =
  | { readonly action: "shell.exec"; readonly raw: string; readonly extraction: Extraction }
  | { readonly action: "fs.write" | "fs.edit" | "fs.read"; readonly path: string }
  | { readonly action: "net.fetch"; readonly url: string; readonly host: string }
  | {
      readonly action: "mcp.call";
      readonly server: string;
      readonly tool: string;
      readonly raw: string;
    };

const SHELL_TOOLS = new Set(["Bash", "bash", "bash_background", "shell", "local_shell"]);
const WRITE_TOOLS = new Set(["Write", "write", "create_file"]);
const EDIT_TOOLS = new Set([
  "Edit",
  "MultiEdit",
  "edit",
  "str_replace_editor",
  "str_replace_based_edit_tool",
]);
const FETCH_TOOLS = new Set(["WebFetch", "web_fetch", "fetch"]);
/** The harness's file-reading tool: Claude Code `Read`, pi/DSH `read`, codex `view`. */
const READ_TOOLS = new Set(["Read", "read", "view", "read_file"]);

/**
 * MCP file-editing tools routed to fs.edit so the fs.edit rules (the floor,
 * the credential/secret ask) govern MCP-driven edits too. Without this a
 * serena `replace_content` writes a guarded path — a shell rc, a repo secret,
 * the guard policy itself — straight past the fs rules, because it arrives as
 * an mcp.call the policy can only match by tool NAME (no argument access), so
 * the path it targets is invisible. An injected "use serena to write ~/.zshrc"
 * would otherwise slip the shell-rc floor. All five carry the target file as
 * `relative_path`.
 */
export const MCP_EDIT_TOOLS = new Set([
  "mcp__serena__replace_symbol_body",
  "mcp__serena__insert_after_symbol",
  "mcp__serena__insert_before_symbol",
  "mcp__serena__replace_content",
  "mcp__serena__safe_delete_symbol",
]);

function stringField(
  input: Readonly<Record<string, unknown>>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function shellRequest(input: Readonly<Record<string, unknown>>): Request | undefined {
  const command = input.command;
  if (typeof command === "string") {
    return { action: "shell.exec", raw: command, extraction: fromString(command) };
  }
  if (Array.isArray(command) && command.every((a) => typeof a === "string")) {
    const argv = command as string[];
    return { action: "shell.exec", raw: argv.join(" "), extraction: fromArgv(argv) };
  }
  return undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** The action a tool name maps to, without reading the input. */
export function actionOf(tool: string): Action | undefined {
  if (SHELL_TOOLS.has(tool)) return "shell.exec";
  if (WRITE_TOOLS.has(tool)) return "fs.write";
  if (EDIT_TOOLS.has(tool)) return "fs.edit";
  if (READ_TOOLS.has(tool)) return "fs.read";
  if (FETCH_TOOLS.has(tool)) return "net.fetch";
  if (MCP_EDIT_TOOLS.has(tool)) return "fs.edit";
  if (tool.startsWith("mcp__")) return "mcp.call";
  return undefined;
}

/**
 * Turn a tool call into a request, or `undefined` when the call is not one
 * the policy speaks about (an unknown tool, or a known tool whose input
 * lacks the field the policy would judge). `undefined` means "no opinion":
 * the evaluator never turns it into a deny.
 */
export function requestFor(call: ToolCall): Request | undefined {
  const action = actionOf(call.tool);
  switch (action) {
    case "shell.exec":
      return shellRequest(call.input);
    case "fs.write":
    case "fs.edit":
    case "fs.read": {
      // `relative_path` is serena's field for the MCP edit tools routed here.
      const path = stringField(call.input, "file_path", "path", "relative_path");
      return path === undefined ? undefined : { action, path };
    }
    case "net.fetch": {
      const url = stringField(call.input, "url");
      const host = url === undefined ? undefined : hostOf(url);
      return url === undefined || host === undefined ? undefined : { action, url, host };
    }
    case "mcp.call": {
      const [, server = "", ...rest] = call.tool.split("__");
      return { action, server, tool: rest.join("__"), raw: call.tool };
    }
    default:
      return undefined;
  }
}
