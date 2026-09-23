/**
 * `~/.claude/rules/`: a managed directory of links (`managed-dir.ts`), one
 * per conditional-rule directory of `llm/harness/rules/` —
 * `~/.claude/rules/<lang>` → `<harness>/rules/<lang>`. Claude Code loads a
 * rule file there when a file matching its `paths:` frontmatter is touched;
 * that is what makes these directories the right thing to link and the
 * always-on `common/` the wrong thing (it is rendered into AGENTS.md, and a
 * link would load it twice).
 *
 * This module is the selection only: which subdirectories of `rules/` get a
 * link. Pure. The caller lists the source directory and hands over the
 * directory names it found.
 */

import type { ManagedSelection } from "./managed-dir";

/**
 * Subdirectories of `rules/` that are NOT conditional-rule directories and
 * must never be linked under `~/.claude/rules/`: `common` because AGENTS.md
 * already carries it, `decisions` and `research` because they are Markdown
 * for humans with no `paths:` frontmatter — linked, Claude Code would load
 * every note and every research record as an always-on rule.
 */
export const NOT_RULE_DIRS: readonly string[] = ["common", "decisions", "research"];

const EXCLUSION_REASON: Readonly<Record<string, string>> = {
  common: "always-on rules, rendered into AGENTS.md — never linked, or they would load twice",
  decisions: "decision notes for humans; linked, they would load as always-on rules",
  research: "research records for humans; linked, they would load as always-on rules",
};

/** Which subdirectories of `rules/` get a link. `dirNames` holds directories only — the caller has already dropped files. */
export function selectRuleDirs(dirNames: readonly string[]): ManagedSelection {
  const linked: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const name of [...dirNames].sort()) {
    const reason = EXCLUSION_REASON[name];
    if (reason === undefined) linked.push(name);
    else excluded.push({ name, reason });
  }
  return { linked, excluded };
}
