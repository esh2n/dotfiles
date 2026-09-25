/**
 * The `git` adapter for the box commands. Only three questions are asked of
 * git here — which repository, which branch, and "fetch this" — so this stays
 * a thin wrapper over the existing `ProcessRunner` rather than a git library.
 */

import type { GitRunner } from "../../app/box/ports";
import type { CommandResult, ProcessRunner } from "../../domain/ports";

export function createGitRunner(proc: ProcessRunner): GitRunner {
  return {
    async toplevel(cwd: string): Promise<string | undefined> {
      const result = await proc.run("git", ["rev-parse", "--show-toplevel"], { cwd });
      if (result.code !== 0) return undefined;
      const path = result.stdout.trim();
      return path === "" ? undefined : path;
    },

    async branch(cwd: string): Promise<string> {
      const result = await proc.run("git", ["branch", "--show-current"], { cwd });
      const name = result.code === 0 ? result.stdout.trim() : "";
      // A detached HEAD has no branch name; the box still needs one to be
      // named after, and "detached" is truer than silently using the hash.
      return name === "" ? "detached" : name;
    },

    async run(args: readonly string[], cwd: string): Promise<CommandResult> {
      return await proc.run("git", args, { cwd });
    },
  };
}
