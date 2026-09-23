/**
 * What the end-of-turn gate runs, and how much of a failure the model sees.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 型検査と lint は
 * 応答の終わりで関門にし、出力は末尾だけに切り詰める。One project, one check —
 * the gate is a backstop behind the LSP diagnostics and the per-edit
 * formatter, not a build.
 *
 * The decision's cost note is the reason for `tail`: 「Stop の関門は空回りすると
 * 高い(35k トークン・20 分の記録)」. A whole `tsc` log in the model's context is
 * exactly that cost, and the last lines are what it needs to act.
 *
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md` puts
 * one branch in front of the marker table: a project with its own hook runner
 * (`lefthook.yml` / `.lefthook.yml` / `.pre-commit-config.yaml`) is gated by
 * that runner on the files touched this turn, and the table below is only for
 * projects with none. `gatePlanFor` is that precedence; `gateCommandFor` is
 * the table alone. The touched files are collected by the adapter (the
 * `ChangedFiles` port in `changed.ts`) and handed in as a list, so this stays
 * pure.
 *
 * Pure: `exists` is injected, nothing is executed.
 */

import { join } from "node:path";
import {
  type ProjectHookTool,
  type ProjectHooks,
  projectHookCommand,
  projectHooksFor,
} from "./project-hooks";

export { projectHooksFor };
export type { ProjectHooks };

const TAIL_LINES = 40;
const TAIL_CHARS = 4_000;

export interface GateCommand {
  readonly label: string;
  readonly bin: string;
  readonly args: readonly string[];
}

/** The check this project answers to, by what is in its root. */
export function gateCommandFor(
  cwd: string,
  exists: (path: string) => boolean,
): GateCommand | undefined {
  const has = (name: string): boolean => exists(`${cwd}/${name}`);
  if (has("tsconfig.json")) {
    return { label: "bunx tsc --noEmit", bin: "bunx", args: ["tsc", "--noEmit"] };
  }
  if (has("go.mod")) return { label: "go vet ./...", bin: "go", args: ["vet", "./..."] };
  if (has("pyproject.toml") || has("ruff.toml") || has(".ruff.toml")) {
    return { label: "ruff check", bin: "ruff", args: ["check", "."] };
  }
  if (has("Cargo.toml")) {
    return { label: "cargo check", bin: "cargo", args: ["check", "--quiet"] };
  }
  return undefined;
}

/**
 * What the gate does for this project:
 *
 * - `run` — a command, with `source` saying whether it is the project's own
 *   hooks or jig's table, and `cwd` the directory to run it in.
 * - `nothing` — with the reason: the project has neither hook config nor a
 *   recognized marker (`no-check`); it has a hook config but git is not
 *   there to list the touched files (`no-git`); or the list is empty
 *   (`no-changes`). A hook config never falls through to the table.
 */
export type GatePlan =
  | (GateCommand & {
      readonly kind: "run";
      readonly source: "project" | "table";
      readonly cwd: string;
      readonly tool?: ProjectHookTool;
    })
  | { readonly kind: "nothing"; readonly reason: "no-check" | "no-git" | "no-changes" };

/**
 * @param changed the files touched this turn, relative to the hook config's
 *   root, or `undefined` when git could not list them. Only consulted when
 *   the project has a hook config; paths that no longer exist are dropped,
 *   since a deleted file is not one to check.
 */
export function gatePlanFor(
  cwd: string,
  exists: (path: string) => boolean,
  changed: readonly string[] | undefined,
): GatePlan {
  const hooks = projectHooksFor(cwd, exists);
  if (hooks !== undefined) {
    if (changed === undefined) return { kind: "nothing", reason: "no-git" };
    const files = [...new Set(changed)].filter(
      (file) => file !== "" && exists(join(hooks.root, file)),
    );
    if (files.length === 0) return { kind: "nothing", reason: "no-changes" };
    const command = projectHookCommand(hooks, files);
    return { kind: "run", source: "project", cwd: hooks.root, tool: hooks.tool, ...command };
  }
  const command = gateCommandFor(cwd, exists);
  if (command === undefined) return { kind: "nothing", reason: "no-check" };
  return { kind: "run", source: "table", cwd, ...command };
}

/** The last lines of a failed run, which is all the model needs to act. */
export function tail(text: string, lines = TAIL_LINES, chars = TAIL_CHARS): string {
  const kept = text.trimEnd().split("\n").slice(-lines).join("\n");
  return kept.length <= chars ? kept : kept.slice(kept.length - chars);
}
