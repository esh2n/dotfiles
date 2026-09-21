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
import type { Action } from "./v2/types";

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
}

export type Request =
  | { readonly action: "shell.exec"; readonly raw: string; readonly extraction: Extraction }
  | { readonly action: "fs.write" | "fs.edit"; readonly path: string }
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
  if (FETCH_TOOLS.has(tool)) return "net.fetch";
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
    case "fs.edit": {
      const path = stringField(call.input, "file_path", "path");
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
