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

import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { editedPaths } from "./map";
import type { OmpToolResultEvent } from "./omp";
import { type Runner, runCommand } from "./run";

const TIMEOUT_MS = 15_000;

/** Where a file's project starts: the nearest ancestor with a project marker. */
const ROOT_MARKERS = [
  "package.json",
  "biome.json",
  "biome.jsonc",
  "go.mod",
  "pyproject.toml",
  "Cargo.toml",
  ".git",
];

export function projectRoot(from: string, exists: (p: string) => boolean = existsSync): string {
  let dir = from;
  for (;;) {
    for (const marker of ROOT_MARKERS) if (exists(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

export interface FormatCommand {
  readonly bin: string;
  readonly args: readonly string[];
}

const WEB_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".css",
]);

/**
 * The formatter for one file: biome when the project configures it (and the
 * local binary when the project vendors one), else prettier, else the
 * language's own. `undefined` means "nothing formats this", which is a skip,
 * not an error.
 */
export function formatterFor(
  file: string,
  root: string,
  exists: (p: string) => boolean = existsSync,
): FormatCommand | undefined {
  const ext = extname(file).toLowerCase();
  if (WEB_EXTENSIONS.has(ext)) {
    const biome = exists(join(root, "biome.json")) || exists(join(root, "biome.jsonc"));
    const local = (name: string): string | undefined => {
      const bin = join(root, "node_modules", ".bin", name);
      return exists(bin) ? bin : undefined;
    };
    if (biome) {
      // `check --write` is format plus the safe lint fixes in one pass, the
      // same invocation the repo's own scripts use.
      return { bin: local("biome") ?? "biome", args: ["check", "--write", file] };
    }
    return { bin: local("prettier") ?? "prettier", args: ["--write", file] };
  }
  switch (ext) {
    case ".go":
      return { bin: "gofmt", args: ["-w", file] };
    case ".py":
      return { bin: "ruff", args: ["format", file] };
    case ".rs":
      return { bin: "rustfmt", args: ["--edition", "2021", file] };
    default:
      return undefined;
  }
}

export interface FormatDeps {
  readonly run?: Runner;
  readonly exists?: (path: string) => boolean;
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
    const root = projectRoot(dirname(file), exists);
    const command = formatterFor(file, root, exists);
    if (command === undefined) continue;
    const result = await run(command.bin, command.args, {
      cwd: root,
      timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    });
    if (!result.missing && result.code === 0) formatted.push(file);
  }
  return formatted;
}
