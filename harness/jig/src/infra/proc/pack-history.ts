/**
 * The `PackHistory` port, backed by git, for the precedence check
 * (`app/apply/precedence-check.ts`).
 *
 * `head` answers only for a directory that is the top of its own checkout
 * (`--show-prefix` prints an empty line there), so a pack directory that
 * happens to sit inside some other repository is not mistaken for one.
 * `changedFiles` compares two trees; a shallow checkout (`dotctl setup
 * plugins` fetches depth 1) may no longer hold the older commit, and git's
 * failure is then `undefined`.
 *
 * Every repository-local variable git knows (`git rev-parse
 * --local-env-vars`, plus `GIT_NAMESPACE` and `GIT_CEILING_DIRECTORIES`) is
 * dropped so an inherited environment does not answer for the checkout;
 * `--no-optional-locks` (what `GIT_OPTIONAL_LOCKS=0` sets) keeps a read from
 * taking the index lock, and `core.fsmonitor=false` keeps a checkout's own
 * config from starting a monitor process.
 */

import type { PackHistory } from "../../app/apply/ports";
import type { Runner } from "../../domain/hooks/run";
import { runCommand } from "./exec-file";

const TIMEOUT_MS = 10_000;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SAFE_ARGS = ["--no-optional-locks", "-c", "core.fsmonitor=false"] as const;

export const GIT_LOCAL_ENV: readonly string[] = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
];

export function packHistoryWith(run: Runner): PackHistory {
  const git = (cwd: string, args: readonly string[]) =>
    run("git", [...SAFE_ARGS, ...args], { cwd, timeoutMs: TIMEOUT_MS, unsetEnv: GIT_LOCAL_ENV });
  return {
    async head(dir) {
      const result = await git(dir, ["rev-parse", "--show-prefix", "HEAD"]);
      if (result.missing || result.code !== 0) return undefined;
      const [prefix, sha] = result.stdout.split("\n");
      if (prefix !== "" || sha === undefined || !COMMIT_RE.test(sha.trim())) return undefined;
      return sha.trim();
    },
    async changedFiles(dir, from, to) {
      const result = await git(dir, ["diff", "--name-only", "--no-renames", "-z", from, to]);
      if (result.missing || result.code !== 0) return undefined;
      return result.stdout.split("\0").filter((path) => path !== "");
    },
  };
}

export const packHistory: PackHistory = packHistoryWith(runCommand);
