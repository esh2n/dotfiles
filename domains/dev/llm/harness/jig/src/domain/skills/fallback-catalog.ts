/**
 * What the model is given when the router cannot produce a selection.
 *
 * This exists for arm B' of the skill-selection experiment. In that arm the harness's own
 * skill listing is hidden — every routable skill carries `disable-model-invocation: true`,
 * which is what `jig skills hide` sets — so the router's injection is the ONLY way a skill
 * reaches the model. A router that fails there does not degrade to "the harness chooses
 * instead"; it degrades to a model that has no skills at all and no way to know it.
 *
 * Two references decided that this must not be silent. dsh-jev's third rule is that a
 * judgment layer runs `off | shadow | enforce` and that a failure in `enforce` is a
 * measured, reported event rather than an absence; pi-jev is fail-open by construction —
 * every path through its arming code that cannot decide returns the unguarded answer rather
 * than nothing. The fallback here is the same shape: the judgment is unavailable, so the
 * decision goes back to the model, WITH the material it needs to make it.
 *
 * What it is not: a recommendation. The router had no opinion, so the rendered text says so
 * in its first line and the list is alphabetical. Any other order would claim a ranking that
 * the failure being reported is precisely the absence of.
 *
 * The owner's condition on the list: language skills must not flood it. 54 skills is more
 * than the harness's own listing is accurate over (Anthropic's tool-search guidance puts the
 * degradation past 30-50 candidates), and most of the excess is language skills for
 * languages the repository in front of the model does not contain. So a skill that declares
 * `paths:` is included only when one of its globs can match something the repository
 * actually holds; a skill that declares none applies anywhere and is always included.
 */

import type { SkillCandidate } from "./candidate";
import { invocation } from "./opener";

/**
 * What the repository in front of the hook is made of, as cheaply as it can be known.
 *
 * Extensions and filenames rather than "languages": a `paths:` glob is matched against file
 * names, so matching it against anything else would mean maintaining a table from globs to
 * language names — a second place to be wrong about what `**\/*.tsx` means.
 */
export interface RepoSignals {
  /**
   * False when the repository could not be read at all (not a checkout, the walk timed out,
   * permission denied). It is not the same as "a repository with no files": with no signals,
   * including every path-scoped skill would flood the list with languages that are not
   * there, so `false` excludes all of them and keeps the ones that apply anywhere.
   */
  readonly known: boolean;
  /** Lowercased extensions including the dot: `.go`, `.ts`, `.md`. */
  readonly extensions: ReadonlySet<string>;
  /** Lowercased bare filenames, for globs whose last segment is a literal (`**\/go.mod`). */
  readonly filenames: ReadonlySet<string>;
}

/** No repository could be read: only the skills that apply anywhere survive. */
export const UNKNOWN_SIGNALS: RepoSignals = {
  known: false,
  extensions: new Set(),
  filenames: new Set(),
};

/** Why the router produced no selection. Recorded verbatim in the router log's `fallback`. */
export type FallbackReason =
  | "unreachable"
  | "timeout"
  | "malformed"
  | "error"
  | "below-threshold"
  | "no-match";

/** The same reasons as a clause the model can read, so the header says what actually broke. */
const REASON_TEXT: Readonly<Record<FallbackReason, string>> = {
  unreachable: "the judgment service was unreachable",
  timeout: "the judgment timed out",
  malformed: "the judgment service answered with something that is not a judgment",
  error: "the judgment failed",
  "below-threshold": "no skill cleared the confidence gate",
  "no-match": "the judgment matched no skill",
};

export interface RenderFallbackOptions {
  /** Whose wording to use for "how to open a skill"; same source as the router's reminder. */
  readonly harness?: string;
  /** Ceiling on the whole rendered text, truncation note included. Default 6,000. */
  readonly maxChars?: number;
  /** Ceiling on one description, before the ellipsis. Default 160. */
  readonly maxDescriptionChars?: number;
}

const DEFAULT_MAX_CHARS = 6_000;
const DEFAULT_MAX_DESCRIPTION_CHARS = 160;

/**
 * Expand one brace group at a time, so `*.{ts,tsx}` reduces to two patterns rather than to
 * one that matches neither. Nested groups expand by recursion; a pattern with no group
 * returns itself, which is the common case.
 */
function expandBraces(glob: string): readonly string[] {
  const open = glob.indexOf("{");
  if (open === -1) return [glob];
  const close = glob.indexOf("}", open);
  if (close === -1) return [glob];

  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return glob
    .slice(open + 1, close)
    .split(",")
    .flatMap((alternative) => expandBraces(`${head}${alternative}${tail}`));
}

/**
 * Can this glob match a file the repository holds?
 *
 * Only the glob's LAST segment is read. A `paths:` glob's directory part says where a file
 * sits, and a repository whose layout differs from the glob's still contains the language
 * the glob is about — `**\/*.go` and `cmd/*.go` are the same claim about a Go repository.
 * Matching the whole path would need the repository's paths rather than its extensions, and
 * would turn "this skill is about Go" into "this skill is about Go laid out this way".
 *
 * Unreducible patterns (`src/**`, `Dockerfile*`) count as matching. The cost of including a
 * skill that does not apply is one line; the cost of excluding one that does is a fallback
 * that hides the very skill the request needed.
 */
function globCanMatch(glob: string, signals: RepoSignals): boolean {
  return expandBraces(glob.trim()).some((pattern) => {
    const segment = pattern
      .split("/")
      .filter((part) => part !== "")
      .pop();
    if (segment === undefined || segment === "") return true;
    if (!/[*?[\]]/.test(segment)) return signals.filenames.has(segment.toLowerCase());
    const extension = /\.[A-Za-z0-9_+-]+$/.exec(segment)?.[0];
    if (extension === undefined) return true;
    return signals.extensions.has(extension.toLowerCase());
  });
}

/**
 * The subset of the catalog worth showing for this repository, in the catalog's own order.
 *
 * A skill with no `paths:` applies anywhere and is kept. A skill with `paths:` is kept only
 * when one of its globs can match something the repository holds — and when nothing is known
 * about the repository, none of them are, because an unfiltered list is the flooding this
 * function exists to prevent.
 */
export function fallbackCatalog(
  catalog: readonly SkillCandidate[],
  signals: RepoSignals,
): readonly SkillCandidate[] {
  return catalog.filter((candidate) => {
    const globs = candidate.paths;
    if (globs === undefined || globs.length === 0) return true;
    if (!signals.known) return false;
    return globs.some((glob) => globCanMatch(glob, signals));
  });
}

/** One line of description: whitespace collapsed, cut on a character count, never on a word. */
function oneLine(description: string, maxChars: number): string {
  const collapsed = description.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars).trimEnd()}…`;
}

/**
 * The text injected in place of a selection.
 *
 * The first line is the one the report's transcript parser keys on to tell this apart from a
 * selection (`infra/transcripts/transcript.ts`): the list below it is written in the router's
 * own `- "<name>": <…>` shape so that a reader sees one format, and without that marker the
 * report would count a 20-skill catalog dump as 20 skills the router chose.
 *
 * Truncation drops from the end of the alphabet and says how many it dropped. That is
 * arbitrary with respect to relevance, and deliberately so: the router failed to rank these,
 * and a cap that cut "the least relevant" would be a ranking invented by the failure handler.
 */
export function renderFallbackCatalog(
  skills: readonly SkillCandidate[],
  reason: FallbackReason,
  options: RenderFallbackOptions = {},
): string {
  const harness = options.harness ?? "unknown";
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxDescriptionChars = options.maxDescriptionChars ?? DEFAULT_MAX_DESCRIPTION_CHARS;

  const header = [
    `jig skill router: no selection for this request (${REASON_TEXT[reason]}).`,
    "The list below is not a recommendation — it is every installed skill that applies to" +
      " this repository's languages, shown because the router had no opinion. Alphabetical;" +
      " pick what the request needs, or none.",
    `${invocation(harness)}.`,
  ].join("\n");

  const lines = [...skills]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((skill) => `- "${skill.name}": ${oneLine(skill.description, maxDescriptionChars)}`);

  const kept: string[] = [];
  let used = header.length;
  for (const line of lines) {
    // The note that would have to be appended if THIS line is the one that does not fit, so
    // a text that ends up truncated is still inside the budget with its note attached.
    const note = `\n… and ${lines.length - kept.length} more (cut at ${maxChars} characters).`;
    if (used + line.length + 1 + note.length > maxChars) {
      return [header, ...kept].join("\n") + note;
    }
    used += line.length + 1;
    kept.push(line);
  }

  return [header, ...kept].join("\n");
}
