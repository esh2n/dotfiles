/**
 * A project's own hook runner — lefthook or pre-commit — and the one command
 * that runs it on a given list of files.
 *
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`:
 * 「プロジェクトの手順が最優先。」When the project root holds `lefthook.yml`
 * (or `.lefthook.yml`) or `.pre-commit-config.yaml`, both the per-edit
 * formatter and the end-of-turn gate run that configuration on the touched
 * files, and jig's own extension → formatter and marker → check tables are
 * not consulted. The tables are the default for projects with no such file.
 * The same ruling forbids the substitution the other way: a project that has
 * the file but not the tool gets told to install it, never jig's table.
 *
 * The argv forms are the two tools' documented ones, not guesses:
 *
 * - lefthook — https://lefthook.dev/usage/commands/run/ ("lefthook run"):
 *   「Executes the commands and scripts configured for a given hook. Installed
 *   Git hooks call `lefthook run` implicitly.」 and, under "Specify files":
 *   「You can force replacing files templates (like {staged_files}) with
 *   either all files (will acts as {all_files} template) or a list of files.
 *   $ lefthook run pre-commit --file file1.js --file file2.js」 — the flag is
 *   `--file`, repeated once per file (not `--files`, not comma-joined). The
 *   page's example runs `lefthook install` first, but states no such
 *   prerequisite for `lefthook run`: it reads `lefthook.yml` directly, and the
 *   installed git hook is only a script that calls it.
 * - pre-commit — https://pre-commit.com/#pre-commit-run ("pre-commit run
 *   [hook-id] [options]"): 「--files [FILES [FILES ...]]: specific filenames
 *   to run hooks on.」 with the example 「git ls-files -- '*.py' | xargs
 *   pre-commit run --files: run all hooks against all *.py files in the
 *   repository.」 — one `--files` followed by every path. `pre-commit run`
 *   needs no `pre-commit install`; but 「The first time pre-commit runs on a
 *   file it will automatically download, install, and run the hook. Note that
 *   running a hook for the first time may be slow.」 — the hook environments
 *   land in `~/.cache/pre-commit` on that first run, which is a cost the
 *   format hook's timeout may not cover once; `pre-commit install-hooks`
 *   pre-pays it.
 *
 * Pure: `exists` is injected, nothing is executed.
 */

import { dirname, join } from "node:path";

export type ProjectHookTool = "lefthook" | "pre-commit";

/**
 * The files the ruling names, in lookup order. lefthook also accepts
 * `.yaml`/`.toml`/`.json` spellings; the ruling lists the two `yml` forms and
 * this follows the ruling, so a project on another spelling gets the table.
 */
const PROJECT_HOOK_FILES: ReadonlyArray<readonly [string, ProjectHookTool]> = [
  ["lefthook.yml", "lefthook"],
  [".lefthook.yml", "lefthook"],
  [".pre-commit-config.yaml", "pre-commit"],
];

/** The marker names, for `projectRoot`'s walk. */
export const PROJECT_HOOK_MARKERS: readonly string[] = PROJECT_HOOK_FILES.map(([name]) => name);

export interface ProjectHooks {
  readonly tool: ProjectHookTool;
  /** The directory holding the config — the cwd the tool runs in. */
  readonly root: string;
  /** The config file's basename, for messages. */
  readonly config: string;
}

/**
 * The nearest ancestor of `from` (inclusive) that holds a hook config, or
 * `undefined` when none does before the repository boundary. Both tools are
 * git-hook managers, so their config lives at the repository root and the
 * walk stops at `.git`: a `lefthook.yml` above the repository is another
 * project's.
 */
export function projectHooksFor(
  from: string,
  exists: (path: string) => boolean,
): ProjectHooks | undefined {
  let dir = from;
  for (;;) {
    for (const [config, tool] of PROJECT_HOOK_FILES) {
      if (exists(join(dir, config))) return { tool, root: dir, config };
    }
    if (exists(join(dir, ".git"))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface ProjectHookCommand {
  readonly label: string;
  readonly bin: string;
  readonly args: readonly string[];
}

/**
 * The tool's `run` on exactly `files`, which are paths relative to
 * `hooks.root` — what git prints and what both tools match their `glob` /
 * `files:` filters against. An empty list is the caller's to catch: both
 * tools would fall back to the staged set, which is not "the files touched".
 */
export function projectHookCommand(
  hooks: ProjectHooks,
  files: readonly string[],
): ProjectHookCommand {
  const count = files.length === 1 ? "1 file" : `${files.length} files`;
  if (hooks.tool === "lefthook") {
    return {
      label: `lefthook run pre-commit (${count})`,
      bin: "lefthook",
      args: ["run", "pre-commit", ...files.flatMap((file) => ["--file", file])],
    };
  }
  return {
    label: `pre-commit run (${count})`,
    bin: "pre-commit",
    args: ["run", "--files", ...files],
  };
}

/**
 * What the owner is told when the config exists but the tool does not.
 * One line, because it is said once per turn and the fix is not the model's.
 */
export function missingToolReason(hooks: ProjectHooks): string {
  const install =
    hooks.tool === "lefthook"
      ? "https://lefthook.dev/installation/"
      : "https://pre-commit.com/#install";
  return (
    `jig gate: this project defines its hooks in \`${hooks.config}\` but \`${hooks.tool}\` is not on PATH — ` +
    `install it (${install}) so the project's own checks can run; jig does not substitute its own table for a project's rules.`
  );
}
