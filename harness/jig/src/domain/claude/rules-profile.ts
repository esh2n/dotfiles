/**
 * A rules profile: which of `rules/common/*.md` a configuration directory's
 * AGENTS.md renders, and whether the decision lines go in at all.
 *
 * The default (no profile) is every common rule plus every accepted
 * decision — the always-on house rules. A profile exists for a configuration
 * directory that must NOT carry some of them: the pstack evaluation profile
 * (`rules/decisions/2026-10-17-pstack-evaluation-profile.md`) keeps the git
 * conventions, the security rules and the language overrides, and drops the
 * rules that say how work is run (TDD, mandatory reviewer agents, grilling,
 * delegation), because the pack under evaluation is itself a way of running
 * work and two routers in one session fight.
 *
 * A profile is a directory `harness/profiles/<name>/` holding `rules.json`
 * (this file's shape) and an optional `rules/*.md` of profile-only rules,
 * rendered after the selected common rules. It selects by file name only:
 * nothing here edits a rule's text.
 *
 * Pure: the caller reads the file and hands over its text.
 */

/** A profile as the apply paths carry it: its name and its directory `harness/profiles/<name>/`. */
export interface RulesProfileRef {
  readonly name: string;
  readonly dir: string;
}

export interface RulesProfile {
  readonly name: string;
  /** `rules/common/` file names to render, in file-name order. */
  readonly common: readonly string[];
  /** Whether the accepted decisions' `rule:` lines are rendered. */
  readonly decisions: boolean;
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const RULE_FILE_RE = /^[A-Za-z0-9_-]+\.md$/;

/** `rules.json` of one profile. Throws on any shape that would silently render the wrong rules. */
export function parseRulesProfile(name: string, text: string): RulesProfile {
  if (!NAME_RE.test(name)) {
    throw new Error(`rules profile name "${name}" is not lowercase letters, digits and hyphens`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`rules profile "${name}": rules.json is not JSON (${String(error)})`);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error(`rules profile "${name}": rules.json must be an object`);
  }
  const record = json as Record<string, unknown>;
  const common = record.common;
  if (!Array.isArray(common) || common.some((entry) => typeof entry !== "string")) {
    throw new Error(`rules profile "${name}": "common" must be an array of file names`);
  }
  for (const file of common as string[]) {
    if (!RULE_FILE_RE.test(file) || file === "README.md") {
      throw new Error(`rules profile "${name}": "${file}" is not a rules/common file name`);
    }
  }
  if (typeof record.decisions !== "boolean") {
    throw new Error(`rules profile "${name}": "decisions" must be true or false`);
  }
  return { name, common: [...(common as string[])], decisions: record.decisions };
}

export interface CommonSelection<T extends { readonly file: string }> {
  readonly kept: readonly T[];
  /** Listed by the profile but not present in `rules/common/` — a typo or a renamed rule. */
  readonly missing: readonly string[];
}

/** The common rules a profile keeps, in the profile's own list order, and the names it asked for that do not exist. */
export function selectCommon<T extends { readonly file: string }>(
  sources: readonly T[],
  profile: RulesProfile,
): CommonSelection<T> {
  const byFile = new Map(sources.map((source) => [source.file, source] as const));
  const kept: T[] = [];
  const missing: string[] = [];
  for (const file of profile.common) {
    const source = byFile.get(file);
    if (source === undefined) missing.push(file);
    else kept.push(source);
  }
  return { kept, missing };
}
