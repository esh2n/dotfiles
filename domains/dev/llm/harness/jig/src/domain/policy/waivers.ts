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
 * approval writes and which git never sees
 * (`rules/research/2026-09-24-main-push-consent-forms.md`). A committed repo
 * file that relaxes a rule has no precedent and vendors distrust it
 * (`rules/research/2026-09-24-project-scoped-rule-override.md`); an
 * environment variable is shell-wide and leaks into every other repository.
 *
 * The waiver is about WHERE the session is, so a command that reaches into
 * another repository is not waived: `git -C <path>`, `--git-dir`,
 * `--work-tree`, a `cd`/`pushd` in the same command line, or a command the
 * reader could not resolve (a subshell, a carrier) — nothing is waived on a
 * guess.
 */

import { basename } from "../subject";
import type { Request } from "./request";

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
    prefixes.push(withSlash(expanded));
  }
  return prefixes;
}

/** Is `cwd` under one of the prefixes? */
export function cwdListed(prefixes: readonly string[], cwd: string): boolean {
  const here = withSlash(cwd);
  return prefixes.some((prefix) => here.startsWith(prefix));
}

/** Arguments that point a program at a repository other than the cwd. */
const ELSEWHERE_ARGV = /^(?:-C|--git-dir(?:=.*)?|--work-tree(?:=.*)?)$/;
const CHANGES_DIR: ReadonlySet<string> = new Set(["cd", "pushd"]);

/**
 * Does the request reach beyond the cwd the waiver was granted for? True
 * when the reader could not resolve the command line, when any command
 * changes directory, or when any command carries a repository-selecting
 * argument. A file operation reaches elsewhere when its path is absolute
 * and not under the listed prefixes.
 */
export function reachesElsewhere(request: Request, prefixes: readonly string[]): boolean {
  switch (request.action) {
    case "shell.exec": {
      const extraction = request.extraction;
      if (extraction.kind !== "resolved") return true;
      return extraction.commands.some(
        (cmd) =>
          CHANGES_DIR.has(basename(cmd.program)) ||
          cmd.argv.some((arg) => ELSEWHERE_ARGV.test(arg)),
      );
    }
    case "fs.write":
    case "fs.edit":
    case "fs.read":
      return request.path.startsWith("/") && !cwdListed(prefixes, request.path);
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
  if (!cwdListed(prefixes, cwd)) return false;
  return !reachesElsewhere(request, prefixes);
}
