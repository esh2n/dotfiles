/**
 * Claude Code `PostToolUse` hook: format the file that was just edited, and
 * say nothing.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 「Claude Code:
 * 整形は編集ごと(PostToolUse)、編集したファイルだけ、無音(exit 0)。」Three
 * constraints, each load-bearing:
 *
 * - *the edited file only* — the payload names one path; the tree is never
 *   walked. The decision's consequence note is explicit about why: per-edit
 *   formatting already risks the mtime problem (claude-code #3513), and a
 *   tree-wide format multiplies it across files the model never touched.
 * - *silent* — the return value is always the empty string and the exit code
 *   is always 0. Claude Code shows a PostToolUse hook's stdout to the model;
 *   a formatter has nothing to tell it, and a line per edit is a per-edit tax
 *   on the context window.
 * - *never fails* — an unparseable payload, a missing formatter, a formatter
 *   that rejects a half-written file: each leaves the file as the model wrote
 *   it and returns. A formatter is not a reason to interrupt anyone.
 *
 * Which formatter and which project root are `domain/hooks/format.ts`'s, the
 * same module omp's adapter uses.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { formatterFor, projectRoot } from "../../domain/hooks/format";
import type { Runner } from "../../domain/hooks/run";
import type { Logger } from "../../domain/ports";

const TIMEOUT_MS = 15_000;

/** The PostToolUse payload, as far as this hook reads it — every field checked. */
interface PostToolUsePayload {
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
  readonly tool_response?: unknown;
  readonly cwd?: unknown;
}

/** The tools that name a file they wrote. Bash is not one of them. */
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export interface FormatHookDeps {
  readonly run: Runner;
  readonly exists?: (path: string) => boolean;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
}

/**
 * `tool_input.file_path`, or NotebookEdit's `notebook_path`. Only a string is
 * accepted: the payload is the harness's shape, not jig's.
 */
function editedPath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const input = toolInput as { file_path?: unknown; notebook_path?: unknown };
  const path = input.file_path ?? input.notebook_path;
  return typeof path === "string" && path !== "" ? path : undefined;
}

/** A tool that reported an error edited nothing worth formatting. */
function succeeded(toolResponse: unknown): boolean {
  if (typeof toolResponse !== "object" || toolResponse === null) return true;
  const response = toolResponse as { success?: unknown; error?: unknown };
  if (response.success === false) return false;
  return response.error === undefined;
}

/**
 * @returns the path formatted, or `undefined` — for tests. The caller writes
 *   nothing to stdout either way.
 */
export async function postToolUseFormat(
  stdin: string,
  deps: FormatHookDeps,
): Promise<string | undefined> {
  const exists = deps.exists ?? existsSync;

  let payload: PostToolUsePayload;
  try {
    payload = JSON.parse(stdin) as PostToolUsePayload;
  } catch {
    deps.logger?.debug("format.unparseable-input", { chars: stdin.length });
    return undefined;
  }

  if (typeof payload.tool_name !== "string" || !EDIT_TOOLS.has(payload.tool_name)) return undefined;
  if (!succeeded(payload.tool_response)) return undefined;

  const named = editedPath(payload.tool_input);
  if (named === undefined) return undefined;

  const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
  const file = isAbsolute(named) ? named : resolve(cwd, named);
  if (!exists(file)) return undefined;

  const root = projectRoot(dirname(file), exists);
  const command = formatterFor(file, root, exists);
  if (command === undefined) return undefined;

  try {
    const result = await deps.run(command.bin, command.args, {
      cwd: root,
      timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    });
    if (result.missing || result.code !== 0) {
      deps.logger?.debug("format.skipped", { file, bin: command.bin, code: result.code });
      return undefined;
    }
  } catch (error) {
    deps.logger?.debug("format.failed", {
      file,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  deps.logger?.debug("format.done", { file, bin: command.bin });
  return file;
}
