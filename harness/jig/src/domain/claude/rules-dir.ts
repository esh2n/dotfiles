/**
 * `~/.claude/rules/`: a managed directory of links (`managed-dir.ts`), one
 * per rule directory of `llm/harness/rules/` other than the three excluded
 * below — `~/.claude/rules/<name>` → `<harness>/rules/<name>`. Claude Code
 * loads a rule file there when a file matching its `paths:` frontmatter is
 * touched; the always-on `common/` must not be linked (it is rendered into
 * AGENTS.md, and a link would load it twice).
 *
 * Since 2026-09-23 no such directory exists: the language rules were folded
 * into the language skills (`rules/decisions/2026-09-23-language-rules-fold-
 * into-skills.md`), so the managed directory reconciles to no links and the
 * stale `<lang>` links are removed on the next apply. The selection stays so
 * a future non-language rule directory would still be delivered.
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
    // A dot-directory is tool state, never a rule directory: a Claude Code
    // session started inside rules/ leaves `.claude/.cc-writes` there
    // (measured 2026-09-24), and linking it would load nothing useful.
    const reason = name.startsWith(".")
      ? "hidden directory — tool state, not rules"
      : EXCLUSION_REASON[name];
    if (reason === undefined) linked.push(name);
    else excluded.push({ name, reason });
  }
  return { linked, excluded };
}
