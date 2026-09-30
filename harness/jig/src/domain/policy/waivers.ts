/**
 * Waivers: the one way a rule is switched off for a repository, by the owner,
 * outside the repository.
 *
 * A rule may carry `unlessCwdIn: "<list name>"`. The list is a plain text
 * file beside the policy (`~/.config/jig/policy/<list name>`), one path
 * prefix per line, that the owner writes by hand and never commits — the
 * policy directory is floor-protected, so no agent can add a line to it.
 * When the calling session's cwd sits under a listed prefix, that rule does
 * not fire; every other rule is untouched, and the judgment records which
 * rules were waived so the audit log says so.
 *
 * The shape is Codex's `[projects."<absolute path>"].trust_level` — a
 * per-repository entry in the user's own configuration, keyed by path — and
 * Claude Code's `.claude/settings.local.json`, which only the human's
 * approval writes and which git never sees. A committed repo
 * file that relaxes a rule has no precedent and vendors distrust it
 * (`rules/decisions/2026-09-24-main-push-allowed-repos-in-owner-policy.md`); an
 * environment variable is shell-wide and leaks into every other repository.
 *
 * The waiver is about WHERE the session is, so a command that reaches into
 * another repository is not waived: git's `-C`, `-c`, `--git-dir`,
 * `--work-tree`, `--config-env`; any shell assignment on the line (`GIT_DIR=`,
 * `env GIT_WORK_TREE=` — the reader drops those, so only the raw text shows
 * them); a push naming its destination by URL or path; a `cd`/`pushd` on the
 * same line; a cwd or path that climbs out with `..`; or a command the reader
 * could not resolve (a subshell, a carrier). Nothing is waived on a guess.
 */

import { posix } from "node:path";
import { basename } from "../subject";
import type { Request } from "./request";

/** `..` and `.` resolved, so `/listed/../work` is not under `/listed/`. */
function normalize(path: string): string {
  return posix.normalize(path);
}

/** List name → absolute path prefixes, each ending in `/`. */
export type Waivers = Readonly<Record<string, readonly string[]>>;

/** Ensure one trailing slash, so `/a/b` never matches `/a/bc`. */
function withSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/**
 * Parse one waiver list: one prefix per line, `~` for the home directory,
 * blank lines and `#` comments ignored. Relative paths are dropped — a prefix
 * has to name a place, not a name that means something else in every cwd.
 */
export function parseWaiverList(text: string, home: string): readonly string[] {
  const prefixes: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const expanded =
      line === "~" ? home : line.startsWith("~/") ? `${withSlash(home)}${line.slice(2)}` : line;
    if (!expanded.startsWith("/")) continue;
    prefixes.push(withSlash(normalize(expanded)));
  }
  return prefixes;
}

/** Is `cwd` under one of the prefixes? */
export function cwdListed(prefixes: readonly string[], cwd: string): boolean {
  const here = withSlash(cwd);
  return prefixes.some((prefix) => here.startsWith(prefix));
}

/** git options that point it at another repository or rewrite its config for one call. */
const GIT_ELSEWHERE =
  /^(?:-C|-c|--git-dir(?:=.*)?|--work-tree(?:=.*)?|--config-env(?:=.*)?|--namespace(?:=.*)?)$/;
const CHANGES_DIR: ReadonlySet<string> = new Set(["cd", "pushd"]);
/**
 * A shell assignment anywhere on the line (`GIT_DIR=… git push`, `env GIT_WORK_TREE=…`).
 * The command reader drops literal prefix assignments and `env NAME=VALUE`, so the
 * resulting command looks exactly like a plain push; the raw text is the only place
 * they are still visible. Any assignment is enough to refuse the waiver.
 */
const ASSIGNMENT = /(?:^|[\s;&|(`])[A-Za-z_][A-Za-z0-9_]*=/;

/** `git push` positionals naming a destination by URL or path rather than by remote name. */
function pushesToExplicitDestination(argv: readonly string[]): boolean {
  const push = argv.indexOf("push");
  if (push === -1) return false;
  const positionals = argv.slice(push + 1).filter((arg) => !arg.startsWith("-"));
  const [destination] = positionals;
  return destination !== undefined && /[/:@\\]/.test(destination);
}

/**
 * Does the request reach beyond the cwd the waiver was granted for? True
 * when the reader could not resolve the command line, when the line carries
 * any shell assignment, when any command changes directory, when git is
 * pointed at another repository (`-C`, `-c`, `--git-dir`, `--work-tree`,
 * `--config-env`), or when a push names its destination by URL or path. A file
 * operation reaches elsewhere when its path, resolved against the cwd, is not
 * under the listed prefixes.
 */
export function reachesElsewhere(
  request: Request,
  prefixes: readonly string[],
  cwd?: string,
): boolean {
  switch (request.action) {
    case "shell.exec": {
      const extraction = request.extraction;
      if (extraction.kind !== "resolved") return true;
      if (ASSIGNMENT.test(request.raw)) return true;
      return extraction.commands.some((cmd) => {
        const program = basename(cmd.program);
        if (CHANGES_DIR.has(program)) return true;
        if (program !== "git") return false;
        return (
          cmd.argv.some((arg) => GIT_ELSEWHERE.test(arg)) || pushesToExplicitDestination(cmd.argv)
        );
      });
    }
    case "fs.write":
    case "fs.edit":
    case "fs.read": {
      if (!request.path.startsWith("/") && cwd === undefined) return true;
      const absolute = request.path.startsWith("/")
        ? request.path
        : `${withSlash(cwd ?? "")}${request.path}`;
      return !cwdListed(prefixes, normalize(absolute));
    }
    case "net.fetch":
    case "mcp.call":
      return false;
  }
}

/**
 * Whether a rule naming `listName` is waived for this request from this cwd.
 * An unknown list, a missing cwd, or a request that reaches elsewhere all
 * mean "not waived".
 */
export function waived(
  listName: string,
  waivers: Waivers,
  cwd: string | undefined,
  request: Request,
): boolean {
  const prefixes = waivers[listName];
  if (prefixes === undefined || prefixes.length === 0 || cwd === undefined) return false;
  if (!cwdListed(prefixes, normalize(cwd))) return false;
  return !reachesElsewhere(request, prefixes, cwd);
}
