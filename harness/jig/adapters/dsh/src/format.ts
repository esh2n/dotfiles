/**
 * Format on edit for DSH: after `write`, `edit` or `str_replace_editor`
 * (create / str_replace / insert) succeeds, format that one file, silently.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md` names DSH's
 * `tools/post-execute` as the place. That event is a waterfall returning a
 * `PostToolDecision`; this listener always returns what `next()` returned, so
 * the model reads back exactly what its own edit produced — the formatter
 * says nothing (the decision's consequences: format what was edited, never a
 * word to the model).
 *
 * Why a native listener and not the `dsh-hooks-claude-code` bridge that ships
 * with DSH: jig's PostToolUse hook reads Claude Code's tool names
 * (`Write`/`Edit`, `file_path`); DSH's are `write`/`edit` (`file_path`) and
 * `str_replace_editor` (`path`), so through the bridge nothing would ever be
 * formatted.
 *
 * Which formatter a file gets — the project's lefthook / pre-commit first,
 * jig's extension table only without one — is jig's own
 * (`src/domain/hooks/format.ts`), shared with Claude Code, pi and omp. Not
 * installed, failed, timed out: all a silent skip.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { type ReadDir, type ReadText, formatPlanFor } from "../../../src/domain/hooks/format";
import type { Runner } from "../../../src/domain/hooks/run";
import { runCommand } from "../../../src/infra/proc/exec-file";

const TIMEOUT_MS = 15_000;

/** The DSH tools that change a file, and the `str_replace_editor` commands that do. */
const WRITING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "str_replace_editor"]);
const EDITOR_WRITES: ReadonlySet<string> = new Set(["create", "str_replace", "insert"]);

const readTextSync: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const readDirSync: ReadDir = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** The file a DSH tool call wrote, or `undefined` when it wrote none. */
export function writtenPath(toolName: string, args: unknown): string | undefined {
  if (!WRITING_TOOLS.has(toolName)) return undefined;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const input = args as Record<string, unknown>;
  if (toolName === "str_replace_editor") {
    if (typeof input.command !== "string" || !EDITOR_WRITES.has(input.command)) return undefined;
    return typeof input.path === "string" && input.path !== "" ? input.path : undefined;
  }
  return typeof input.file_path === "string" && input.file_path !== ""
    ? input.file_path
    : undefined;
}

export interface FormatDeps {
  readonly run?: Runner;
  readonly exists?: (path: string) => boolean;
  readonly readText?: ReadText;
  readonly readDir?: ReadDir;
  readonly timeoutMs?: number;
}

/**
 * Format the file one successful tool call wrote. Returns the file formatted
 * (for tests); DSH is told nothing.
 */
export async function formatAfterExecute(
  toolName: string,
  args: unknown,
  isError: boolean,
  cwd: string,
  deps: FormatDeps = {},
): Promise<string | undefined> {
  if (isError) return undefined;
  const path = writtenPath(toolName, args);
  if (path === undefined) return undefined;
  const exists = deps.exists ?? existsSync;
  const file = isAbsolute(path) ? path : resolve(cwd, path);
  if (!exists(file)) return undefined;
  const plan = formatPlanFor(
    file,
    exists,
    deps.readText ?? readTextSync,
    deps.readDir ?? readDirSync,
  );
  if (plan === undefined) return undefined;
  const result = await (deps.run ?? runCommand)(plan.bin, plan.args, {
    cwd: plan.cwd,
    timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
  });
  return !result.missing && result.code === 0 ? file : undefined;
}
