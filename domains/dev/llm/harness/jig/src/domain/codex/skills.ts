/**
 * `~/.codex/skills/`: a managed directory of links (`../claude/managed-dir.ts`),
 * one per skill that carries a Codex port —
 * `~/.codex/skills/<name>` → `<harness>/skills/<name>/codex`.
 *
 * Every skill reaches Codex through `~/.agents/skills/` already, the user
 * scope of Codex's documented discovery table
 * (https://learn.chatgpt.com/docs/build-skills, "Skill discovery paths":
 * `$HOME/.agents/skills` — "Personal skills across repositories"; the same
 * directory pi and omp read). A port is the exception: a second `SKILL.md`
 * under `<name>/codex/`, written for Codex's tool surface, and it goes into
 * Codex's own directory beside the bundled `.system/` skills. Only skills
 * that have one get a link here; the rest are listed with why, so the
 * dry-run reads as a decision and not an omission.
 *
 * The same page says of duplicate names: "If two skills share the same
 * `name`, Codex doesn't merge them; both can appear in skill selectors." A
 * ported skill is therefore listed twice in Codex — the generic entry and
 * the port. The generator delivers both as the sources say and reports the
 * count; whether the generic entry should yield is a ruling, not a
 * generator feature.
 *
 * Pure. The caller lists the source directory, probes each entry for
 * `SKILL.md` and `codex/SKILL.md`, and hands over what it found.
 */

import type { PathState } from "../claude/links";
import type { ManagedSelection } from "../claude/managed-dir";

/** One entry of `<harness>/skills/`, with whether `<entry>/SKILL.md` and `<entry>/codex/SKILL.md` are regular files. */
export interface CodexSkillCandidate {
  readonly name: string;
  readonly state: PathState;
  readonly hasSkillMd: boolean;
  readonly hasCodexPort: boolean;
}

/** The subdirectory a Codex port lives in, under the skill. */
export const CODEX_PORT_DIR = "codex";

/** Why most skills get no link here — the expected case, which the dry-run counts rather than lists. */
export const NO_CODEX_PORT_REASON = `no ${CODEX_PORT_DIR}/SKILL.md — reaches Codex through ~/.agents/skills`;

/** Which entries of `skills/` get a link under `~/.codex/skills`: those with a `codex/SKILL.md`. */
export function selectCodexSkillPorts(
  candidates: readonly CodexSkillCandidate[],
): ManagedSelection {
  const linked: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const candidate of [...candidates].sort((a, b) => compare(a.name, b.name))) {
    const reason = skipReason(candidate);
    if (reason === undefined) linked.push(candidate.name);
    else excluded.push({ name: candidate.name, reason });
  }
  return { linked, excluded };
}

function skipReason(candidate: CodexSkillCandidate): string | undefined {
  switch (candidate.state.kind) {
    case "file":
      return "a file, not a skill directory";
    case "missing":
      return "vanished between listing and inspection";
    case "dir":
    case "symlink":
      if (!candidate.hasSkillMd) return "no SKILL.md inside, so not a skill";
      return candidate.hasCodexPort ? undefined : NO_CODEX_PORT_REASON;
  }
}

/** `~/.codex/skills/<name>` points at the port, not at the skill's root. */
export function codexPortTarget(sourceDir: string, name: string): string {
  return `${sourceDir}/${name}/${CODEX_PORT_DIR}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
