/**
 * Which formatter one edited file gets, and where its project starts.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 整形は編集ごと、
 * 編集したファイルだけ、無音。The "edited file only, never the tree" part is
 * enforced by shape — every function here takes a single file.
 *
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md` puts
 * one branch in front of all of that: a project with its own hook runner
 * (`lefthook.yml` / `.lefthook.yml` / `.pre-commit-config.yaml`) gets that
 * runner on the edited file, and the extension table below is only for
 * projects with none. `formatPlanFor` is that precedence; `formatterFor` is
 * the table alone.
 *
 * Pure: `exists` is injected, nothing is executed. The harness adapters
 * (`cli/hooks/post-tool-use-format.ts` for Claude Code,
 * `adapters/omp/src/format.ts` for omp) supply the event decoding and the
 * runner; this decides only what to run.
 */

import { dirname, extname, join, relative } from "node:path";
import { PROJECT_HOOK_MARKERS, projectHookCommand, projectHooksFor } from "./project-hooks";

/**
 * Where a file's project starts: the nearest ancestor with a project marker.
 * The hook configs are markers too, so a project that has nothing but a
 * `lefthook.yml` still has a root.
 */
const ROOT_MARKERS = [
  ...PROJECT_HOOK_MARKERS,
  "package.json",
  "biome.json",
  "biome.jsonc",
  "go.mod",
  "pyproject.toml",
  "Cargo.toml",
  ".git",
];

export function projectRoot(from: string, exists: (path: string) => boolean): string {
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
  exists: (path: string) => boolean,
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

/**
 * What formats one file, with where the answer came from: `project` is the
 * project's own hook runner, `table` is jig's extension table. The adapters
 * log `source`; the ruling's "never substitute" clause depends on their
 * treating a missing `project` tool differently from a missing `table` one.
 */
export interface FormatPlan extends FormatCommand {
  readonly source: "project" | "table";
  /** The directory to run in: the hook config's, or the table's project root. */
  readonly cwd: string;
}

/** The project's hooks on this one file if it has any, else the table. */
export function formatPlanFor(
  file: string,
  exists: (path: string) => boolean,
): FormatPlan | undefined {
  const hooks = projectHooksFor(dirname(file), exists);
  if (hooks !== undefined) {
    const command = projectHookCommand(hooks, [relative(hooks.root, file)]);
    return { source: "project", bin: command.bin, args: command.args, cwd: hooks.root };
  }
  const root = projectRoot(dirname(file), exists);
  const command = formatterFor(file, root, exists);
  return command === undefined ? undefined : { source: "table", ...command, cwd: root };
}
