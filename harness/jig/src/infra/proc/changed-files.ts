/**
 * The `ChangedFiles` port, backed by git: the modified-tracked set and the
 * untracked-not-ignored set, both relative to `cwd`.
 *
 * `git diff --name-only --relative HEAD` — `--relative` because without it
 * git prints paths from the repository top level whatever the cwd, while
 * `git ls-files --others --exclude-standard` prints them relative to the cwd;
 * the two lists have to agree so the project's hook runner (which runs in
 * that same cwd) can find every file.
 *
 * A repository with no commit yet has no `HEAD`, so the diff fails while the
 * untracked listing still works; only when git itself is missing, or neither
 * command runs, is the answer `undefined`.
 */

import type { ChangedFiles } from "../../domain/hooks/changed";
import type { Runner } from "../../domain/hooks/run";
import { runCommand } from "./exec-file";

const TIMEOUT_MS = 10_000;

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

export function changedFilesWith(run: Runner): ChangedFiles {
  return async (cwd) => {
    const options = { cwd, timeoutMs: TIMEOUT_MS };
    const [tracked, untracked] = await Promise.all([
      run("git", ["diff", "--name-only", "--relative", "HEAD"], options),
      run("git", ["ls-files", "--others", "--exclude-standard"], options),
    ]);
    if (tracked.missing || untracked.missing) return undefined;
    if (tracked.code !== 0 && untracked.code !== 0) return undefined;
    const found = new Set<string>();
    if (tracked.code === 0) for (const line of lines(tracked.stdout)) found.add(line);
    if (untracked.code === 0) for (const line of lines(untracked.stdout)) found.add(line);
    return [...found];
  };
}

export const changedFiles: ChangedFiles = changedFilesWith(runCommand);
