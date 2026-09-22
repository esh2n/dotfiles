/**
 * `~/.claude/rules/`: a real directory jig manages, holding one symlink per
 * conditional-rule directory of `llm/harness/rules/` —
 * `~/.claude/rules/<lang>` → `<harness>/rules/<lang>`. Claude Code loads a
 * rule file there when a file matching its `paths:` frontmatter is touched;
 * that is what makes these directories the right thing to link and the
 * always-on `common/` the wrong thing (it is rendered into AGENTS.md, and a
 * link would load it twice).
 *
 * Reconciliation is Stow-like and stays inside what jig made: a link that is
 * no longer planned is removed only when it points into the harness's own
 * `rules/`; anything else in the directory — a user's own rule file, a link
 * elsewhere — is reported and left alone.
 *
 * Pure. The caller lists both directories and hands over what it found.
 */

import { type LinkPlan, type PathState, planLink } from "./links";

/**
 * Subdirectories of `rules/` that are NOT conditional-rule directories and
 * must never be linked under `~/.claude/rules/`: `common` because AGENTS.md
 * already carries it, `decisions` and `research` because they are Markdown
 * for humans with no `paths:` frontmatter — linked, Claude Code would load
 * every note and every research record as an always-on rule.
 */
export const NOT_RULE_DIRS: readonly string[] = ["common", "decisions", "research"];

export interface RuleDirSelection {
  /** Directory names to link, sorted. */
  readonly linked: readonly string[];
  /** The excluded ones that were present, with why — so the dry-run can say so. */
  readonly excluded: readonly { readonly name: string; readonly reason: string }[];
}

const EXCLUSION_REASON: Readonly<Record<string, string>> = {
  common: "always-on rules, rendered into AGENTS.md — never linked, or they would load twice",
  decisions: "decision notes for humans; linked, they would load as always-on rules",
  research: "research records for humans; linked, they would load as always-on rules",
};

/** Which subdirectories of `rules/` get a link. `dirNames` holds directories only — the caller has already dropped files. */
export function selectRuleDirs(dirNames: readonly string[]): RuleDirSelection {
  const linked: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const name of [...dirNames].sort()) {
    const reason = EXCLUSION_REASON[name];
    if (reason === undefined) linked.push(name);
    else excluded.push({ name, reason });
  }
  return { linked, excluded };
}

/** One entry of `~/.claude/rules/`, as `lstat` sees it. */
export interface RulesDirEntry {
  readonly name: string;
  readonly state: PathState;
}

export type RulesEntryAction =
  /** A planned link, with what `--write` does to the path. */
  | { readonly kind: "link"; readonly name: string; readonly plan: LinkPlan }
  /** A link jig made earlier that points into the harness's `rules/` but is no longer planned: removed. */
  | {
      readonly kind: "stale";
      readonly name: string;
      readonly path: string;
      readonly target: string;
    }
  /** Anything else: not jig's, left alone, reported. */
  | {
      readonly kind: "foreign";
      readonly name: string;
      readonly path: string;
      readonly what: string;
    };

export interface ReconcileRulesDirInput {
  /** Destination directory: `~/.claude/rules`. */
  readonly rulesDir: string;
  /** Source directory: `<harness>/rules`. Links point under it. */
  readonly harnessRules: string;
  /** From `selectRuleDirs`. */
  readonly planned: readonly string[];
  /** The destination's current entries; `[]` when it does not exist yet. */
  readonly entries: readonly RulesDirEntry[];
}

/** Planned links first (in plan order), then stale links, then foreign entries, each group sorted by name. */
export function reconcileRulesDir(input: ReconcileRulesDirInput): readonly RulesEntryAction[] {
  const byName = new Map(input.entries.map((entry) => [entry.name, entry.state]));
  const actions: RulesEntryAction[] = [];

  for (const name of input.planned) {
    const path = `${input.rulesDir}/${name}`;
    const target = `${input.harnessRules}/${name}`;
    actions.push({
      kind: "link",
      name,
      plan: planLink(path, target, byName.get(name) ?? { kind: "missing" }),
    });
  }

  const plannedSet = new Set(input.planned);
  const rest = [...input.entries]
    .filter((entry) => !plannedSet.has(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const stale: RulesEntryAction[] = [];
  const foreign: RulesEntryAction[] = [];
  for (const entry of rest) {
    const path = `${input.rulesDir}/${entry.name}`;
    if (entry.state.kind === "symlink" && entry.state.target.startsWith(`${input.harnessRules}/`)) {
      stale.push({ kind: "stale", name: entry.name, path, target: entry.state.target });
    } else {
      foreign.push({ kind: "foreign", name: entry.name, path, what: describe(entry.state) });
    }
  }
  return [...actions, ...stale, ...foreign];
}

function describe(state: PathState): string {
  switch (state.kind) {
    case "symlink":
      return `a symlink → ${state.target}`;
    case "dir":
      return "a directory";
    case "file":
      return "a regular file";
    case "missing":
      return "missing";
  }
}
