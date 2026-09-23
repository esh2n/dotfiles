/**
 * Format on edit: after `edit` or `write` succeeds, format that one file,
 * silently.
 *
 * The rule comes from `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`,
 * which names Claude Code, pi, DSH and codex but not omp. omp's event surface
 * is pi's, so pi's line applies: "`tool_result` で編集ごとに整形" — format on
 * the result event, the edited files only, never the tree, and never a word
 * to the model. The decision's consequences section is equally binding: the
 * hook formats what was edited and says nothing.
 *
 * Silence means the handler returns `undefined` — omp's `ToolResultEventResult`
 * is an override, and overriding `content` here would rewrite what the model
 * reads back from its own edit.
 *
 * Not installed → skip. That is the whole error policy: a formatter that
 * cannot run is not a reason to interrupt anyone, and any failure (missing
 * binary, syntax error mid-edit, timeout) leaves the file as the model wrote
 * it.
 *
 * Note one overlap: omp does its own format-on-write through LSP when that is
 * configured (`docs/tools/write.md`). This runs the project's formatter,
 * which is what the repo's own tooling checks; running both is idempotent.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  type FormatCommand,
  type FormatPlan,
  type ReadText,
  formatterFor as chooseFormatter,
  formatPlanFor as choosePlan,
  projectRoot as findProjectRoot,
} from "../../../src/domain/hooks/format";
import { editedPaths } from "./map";
import type { OmpToolResultEvent } from "./omp";
import { type Runner, runCommand } from "./run";

const TIMEOUT_MS = 15_000;

/** `package.json` / `Cargo.toml` text for the table's config lookups; unreadable is "no text". */
const readTextSync: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/**
 * Which formatter a file gets, and where its project starts, are jig's own
 * (`src/domain/hooks/format.ts`) — shared verbatim with the Claude Code
 * PostToolUse hook, so the two harnesses cannot drift into formatting the same
 * file two different ways. That includes the precedence of
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`
 * (`formatPlanFor`: the project's lefthook / pre-commit on the file first,
 * the extension table only without one). Wrapped here only to bind omp's
 * `existsSync` default, which a pure module does not get to have.
 */
export type { FormatCommand, FormatPlan, ReadText };

export function formatPlanFor(
  file: string,
  exists: (p: string) => boolean = existsSync,
  readText: ReadText = readTextSync,
): FormatPlan | undefined {
  return choosePlan(file, exists, readText);
}

export function projectRoot(from: string, exists: (p: string) => boolean = existsSync): string {
  return findProjectRoot(from, exists);
}

export function formatterFor(
  file: string,
  root: string,
  exists: (p: string) => boolean = existsSync,
  readText: ReadText = readTextSync,
): FormatCommand | undefined {
  return chooseFormatter(file, root, exists, readText);
}

export interface FormatDeps {
  readonly run?: Runner;
  readonly exists?: (path: string) => boolean;
  /** For the table's `package.json` (stylelint) and `Cargo.toml` (edition) lookups. */
  readonly readText?: ReadText;
  readonly timeoutMs?: number;
}

/** The files formatted, for tests; omp itself is told nothing. */
export async function formatOnResult(
  event: OmpToolResultEvent,
  cwd: string,
  deps: FormatDeps = {},
): Promise<readonly string[]> {
  if (event.isError === true) return [];
  if (event.toolName !== "edit" && event.toolName !== "write" && event.toolName !== "apply_patch") {
    return [];
  }
  const exists = deps.exists ?? existsSync;
  const run = deps.run ?? runCommand;
  const formatted: string[] = [];
  for (const path of editedPaths(event.toolName, event.input, event.details)) {
    // A write to an internal resource (`xd://`, `conflict://`, a `.zip`
    // entry) is not a file on disk; only real files are formatted.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) continue;
    const file = isAbsolute(path) ? path : resolve(cwd, path);
    if (!exists(file)) continue;
    const plan = formatPlanFor(file, exists, deps.readText ?? readTextSync);
    if (plan === undefined) continue;
    // A project hook runner that is not installed is a skip here too — the
    // ruling forbids the table as its substitute, and the stop gate is what
    // tells the owner; a formatter never says anything.
    const result = await run(plan.bin, plan.args, {
      cwd: plan.cwd,
      timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    });
    if (!result.missing && result.code === 0) formatted.push(file);
  }
  return formatted;
}
