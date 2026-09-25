/**
 * `jig apply` — regenerate a target's configuration from the canonical sources
 * under `llm/harness/` and either show the diff (default) or write it
 * (`--write`). Thin: argv parsing and text formatting only, delegating the
 * actual decision-making to `app/apply/*`. The composition root (`./jig.ts`)
 * builds the real ports and resolves the paths; this module never touches
 * `process.env` or the filesystem itself, so it is testable with any fake
 * ports and any paths.
 *
 * Two kinds of target live behind the one verb:
 *
 * - **pi / dsh / litellm** — model tiers, from `policy/tiers.json`, into files
 *   inside this repository (`app/apply/apply-tiers.ts`).
 * - **claude** — `~/.claude/settings.json` from `policy/guard-rules.json` and
 *   `mcp/servers.json`, the generated `~/.claude/AGENTS.md` from `rules/`,
 *   the `CLAUDE.md` symlink, and the managed `skills/`, `agents/` and
 *   `rules/` directories of per-entry symlinks into the harness
 *   (`app/apply/apply-claude.ts`). Milestones 1 and 2 of the generator that
 *   retires `yoki-switch`.
 * - **codex** — `~/.agents/skills` as a managed directory of links (the
 *   only skills delivery Codex gets; `~/.codex/skills` is reported, not
 *   managed), the same generated AGENTS.md into `~/.codex`, one generated
 *   `~/.codex/agents/<name>.toml` per agent with the model from
 *   `agents/models.json`, and jig's MCP block in `~/.codex/config.toml`
 *   (`app/apply/apply-codex.ts`). Milestone 3a.
 * - **omp** — the same `~/.agents/skills`, one generated
 *   `~/.omp/agent/agents/<name>.md` per agent, jig's entries in
 *   `~/.omp/agent/mcp.json`, and the `extensions/jig.ts` link to jig's omp
 *   extension (`app/apply/apply-omp.ts`). Milestone 3b.
 * - **pi**, the agent-directory half — the same `~/.agents/skills`, the
 *   same generated AGENTS.md into `~/.pi/agent` (over the symlink standing
 *   there today), and jig's entries in pi-mcp-adapter's
 *   `~/.config/mcp/mcp.json`; packages, extensions and the two gaps
 *   reported (`app/apply/apply-pi.ts`). Milestone 3c-pi. `--target pi`
 *   names one harness, so it runs both halves: the tiers write into the
 *   checkout's `pi/models.json` (the first group's part), then this.
 * - **dsh**, the harness-home half — jig's `@deepseek-ai/dsh-mcp-client`
 *   rows in each scaffolded-and-repo-owned profile's `cordis.patch.yml`
 *   under `$DSH_HOME/profiles/`, and the same generated AGENTS.md into
 *   `$DSH_HOME`; skills, the home-level patch, settings.yaml,
 *   hooks.claude.json and the guard plugin reported
 *   (`app/apply/apply-dsh.ts`). Milestone 3c-dsh. `--target dsh` runs both
 *   halves the way `--target pi` does: the tiers write into the checkout's
 *   `dsh/settings.yaml` first, then this.
 *
 * `--target all` means the first group only. The claude, codex and omp
 * targets, and pi's and dsh's second halves, write into `$HOME` rather than
 * into the checkout, so each has to be named: a verb that reaches a user's
 * live harness configuration by default is one keystroke from a surprise,
 * and nothing about the word "all" says which files it means.
 */

import {
  type ClaudeApplyPaths,
  type ClaudeApplyReport,
  type LinkReport,
  type ManagedDirReport,
  type OptionalManagedDirReport,
  applyClaude,
} from "../app/apply/apply-claude";
import {
  type AgentFileReport,
  type CodexApplyOptions,
  type CodexApplyPaths,
  type CodexApplyReport,
  applyCodex,
} from "../app/apply/apply-codex";
import {
  DSH_INSTRUCTIONS_BUDGET_BYTES,
  type DshApplyPaths,
  type DshApplyReport,
  type DshProfileReport,
  applyDsh,
} from "../app/apply/apply-dsh";
import {
  type OmpAgentFileReport,
  type OmpApplyOptions,
  type OmpApplyPaths,
  type OmpApplyReport,
  applyOmp,
} from "../app/apply/apply-omp";
import { type PiApplyPaths, type PiApplyReport, applyPi } from "../app/apply/apply-pi";
import {
  ALL_APPLY_TARGETS,
  type ApplyTarget,
  type ApplyTargetPaths,
  type TargetResult,
  applyTiers,
} from "../app/apply/apply-tiers";
import { AGENTS_SKILLS_MOUNT_TARGETS, type AgentsSkillsMountReport } from "../app/apply/delivery";
import type { ApplyPorts, ClaudeApplyPorts } from "../app/apply/ports";
import type { ModelChoice } from "../domain/claude/agent-definition";
import { AGENTS_MD_BYTE_LIMIT } from "../domain/claude/agents-md";
import type { ClaudeHookPaths } from "../domain/claude/hooks";
import type { PathState } from "../domain/claude/links";
import { describePathState, describeStaleReason } from "../domain/claude/managed-dir";
import { DEFAULT_PERMITS, defaultPermitPolicyFragment } from "../domain/claude/permits";
import { KNOWN_MACOS_EXCLUSION_CANDIDATES } from "../domain/claude/sandbox";

export interface ApplyCliResult {
  readonly stdout: string;
  readonly code: number;
}

interface ParsedArgs {
  readonly targets: readonly ApplyTarget[];
  readonly claude: boolean;
  readonly codex: boolean;
  readonly omp: boolean;
  /** `--target pi`: the tiers half (`targets` holds `pi` too) plus the agent-directory half. */
  readonly pi: boolean;
  /** `--target dsh`: the tiers half (`targets` holds `dsh` too) plus the harness-home half. */
  readonly dsh: boolean;
  readonly write: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs | { readonly error: string } {
  let targetArg: string | undefined;
  let write = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") {
      write = true;
    } else if (arg === "--target") {
      i++;
      targetArg = args[i];
    } else if (arg?.startsWith("--target=")) {
      targetArg = arg.slice("--target=".length);
    } else {
      return { error: `unknown argument ${JSON.stringify(arg)}` };
    }
  }

  const targetName = targetArg ?? "all";
  const none = {
    targets: [],
    claude: false,
    codex: false,
    omp: false,
    pi: false,
    dsh: false,
    write,
  };
  if (targetName === "claude") return { ...none, claude: true };
  if (targetName === "codex") return { ...none, codex: true };
  if (targetName === "omp") return { ...none, targets: ["omp"], omp: true };
  if (targetName === "pi") return { ...none, targets: ["pi"], pi: true };
  if (targetName === "dsh") return { ...none, targets: ["dsh"], dsh: true };
  if (targetName === "all") return { ...none, targets: ALL_APPLY_TARGETS };
  if ((ALL_APPLY_TARGETS as readonly string[]).includes(targetName)) {
    return { ...none, targets: [targetName as ApplyTarget] };
  }
  return {
    error: `unknown --target ${JSON.stringify(targetName)} (expected claude, codex, omp, pi, dsh, litellm, or all)`,
  };
}

function formatResult(result: TargetResult): string {
  const lines: string[] = [`== ${result.target} ==`, `outcome: ${result.outcome}`];
  if (result.message) {
    lines.push(`message: ${result.message}`);
  }
  if (result.diff !== "") {
    lines.push("--- diff (current vs generated) ---", result.diff);
  } else if (result.preview !== undefined) {
    lines.push("--- generated block (no diff: markers not present yet) ---", result.preview);
  } else {
    lines.push("(no differences)");
  }
  if (result.dropped.length > 0) {
    lines.push(`dropped fields (${result.dropped.length}):`);
    for (const d of result.dropped) {
      lines.push(`  - ${d.tier}:${d.field} — ${d.reason}`);
    }
  }
  return lines.join("\n");
}

/** A --write request for pi/dsh that could not actually write (no markers, no dest) is a real failure; litellm refusing --write is the documented, correct behavior. */
function isBlockedWriteFailure(result: TargetResult, wroteRequested: boolean): boolean {
  if (!wroteRequested || result.target === "litellm") return false;
  return result.outcome === "markers-missing" || result.outcome === "dest-missing";
}

const PAD = 17;

/**
 * The Claude Code target's dry-run. Three questions in order — what jig now
 * owns, what it leaves alone, what it takes away — because the third is the
 * one a reader has to agree to before `--write`, and burying it under a
 * 200-line diff is how a one-time cleanup becomes a surprise. Then the
 * milestone-2 delivery, one line per destination: the generated AGENTS.md,
 * the `CLAUDE.md` symlink with what stands at its path today, the three
 * managed directories' entries, and the retired `commands`.
 */
function formatClaude(report: ClaudeApplyReport, dest: string): string {
  const { composition } = report;
  const lines: string[] = [
    "== claude ==",
    `outcome: ${report.outcome}`,
    `dest: ${dest}`,
    ...(report.message === undefined ? [] : [`message: ${report.message}`]),
    "",
    `hooks (${report.hookCommands.length}):`,
    ...report.hookCommands.map((h) => `  ${h.event.padEnd(PAD)}${h.command}`),
    "",
    `keys jig now owns (${composition.owned.length}):`,
    ...composition.owned.map((key) => `  ${key}`),
    "",
    `keys left as-is (${composition.left.length}):`,
    ...composition.left.map((key) => `  ${key}`),
    "",
  ];

  const removedTotal = composition.removed.reduce((sum, group) => sum + group.items.length, 0);
  lines.push(
    `keys jig would REMOVE (${removedTotal} values across ${composition.removed.length} keys):`,
  );
  if (composition.removed.length === 0) lines.push("  (nothing)");
  for (const group of composition.removed) {
    lines.push(
      `  ${group.key} (${group.items.length})${group.reason === undefined ? "" : ` — ${group.reason}`}:`,
    );
    for (const item of group.items) lines.push(`    - ${item}`);
  }

  lines.push(
    "",
    `default permits, fallback until they exist in the policy file (${DEFAULT_PERMITS.length}):`,
    ...DEFAULT_PERMITS.map((permit) => `  ${permit.rule.padEnd(24)}${permit.why}`),
    "",
    "  policy/guard-rules.json is not agent-writable by design (floor-policy-write).",
    "  Paste these into its `rules` array by hand; the projection then produces the",
    "  same entries and the fallback above becomes a no-op:",
    ...defaultPermitPolicyFragment()
      .split("\n")
      .map((line) => `  ${line}`),
    "",
    `guard rules with no native form (${report.hookOnly.length}):`,
    "  permissions.deny is a backstop only. Enforcement is the PreToolUse hook —",
    "  a hook deny holds in every permission mode, and these rules have no native",
    "  form at all, so removing the hook removes them entirely.",
    ...report.hookOnly.map((rule) => `  ${rule.id.padEnd(30)}${rule.reason}`),
    "",
    ...sandboxLines(report),
    "",
    ...mcpLines(report),
    "",
  );

  lines.push(
    report.diff === "" ? "(no differences)" : "--- diff (current vs generated) ---",
    ...(report.diff === "" ? [] : [report.diff]),
    "",
    ...agentsMdLines(report),
    "",
    ...linkLines(report),
    "",
    ...managedDirLines("skills", report.skillsDir, {
      noun: "skill director",
      plural: "ies",
      singular: "y",
      how: "each holds a SKILL.md",
      foreignNote: [
        "Claude Code writes its own entries here (`synced/` from the claude.ai account and its",
        ".bucket-<id> marker); that is why this is a directory of links and not one link.",
      ],
    }),
    "",
    ...managedDirLines("agents", report.agentsDir, {
      noun: "agent definition",
      plural: "s",
      singular: "",
      how: "*.md files",
    }),
    "",
    ...managedDirLines("rules", report.rulesDir, {
      noun: "conditional-rule director",
      plural: "ies",
      singular: "y",
      how: "paths: frontmatter decides when each loads",
    }),
    "",
    ...commandsLines(report),
    "",
    ...optionalDirLines("scripts", report.scriptsDir, {
      noun: "script",
      plural: "s",
      singular: "",
      how: "regular files; settings.json's statusLine.command names ~/.claude/scripts/statusline.sh",
    }),
    "",
    ...optionalDirLines("workflows", report.workflowsDir, {
      noun: "workflow entr",
      plural: "ies",
      singular: "y",
      how: "*.js scripts for Claude Code's Workflow tool, plus lib/ when present",
    }),
  );
  return lines.join("\n");
}

/**
 * A milestone-4 managed directory whose source may not exist yet: the same
 * section as the other three when it does, one report line when it does not
 * — the owner's move is a prerequisite, and the destination is left as found.
 */
function optionalDirLines(
  label: string,
  report: OptionalManagedDirReport,
  wording: ManagedDirWording,
): readonly string[] {
  if (report.dir !== undefined) return managedDirLines(label, report.dir, wording);
  const found =
    report.destinationState.kind === "missing"
      ? "absent"
      : describePathState(report.destinationState);
  return [
    `${label} directory: not planned  (no ${report.sourceDir} yet)`,
    `  the destination is ${found} and is left as found until the source directory exists;`,
    "  move the files there by hand (milestone 4 prerequisite), then apply again.",
  ];
}

/** One word per destination state, and what it costs. */
function describeLink(link: LinkReport): string {
  switch (link.state) {
    case "ok":
      return "ok";
    case "create":
      return "create";
    case "replace":
      return `replace (currently → ${link.previousTarget})`;
    case "backup-then-create":
      return `backup-then-create (existing file/directory → ${link.backupPath})`;
  }
}

/** `width` is the label column; a section with long entry names widens it so the columns still line up. */
function linkLine(label: string, link: LinkReport, width = PAD): string {
  return `  ${label.padEnd(width)}${describeLink(link).padEnd(20)} → ${link.target}`;
}

/** The generated file: its outcome, its size against the Codex limit, and what went in. */
function agentsMdLines(report: ClaudeApplyReport): readonly string[] {
  const { agentsMd } = report;
  const lines: string[] = [
    `AGENTS.md: ${agentsMd.outcome}  ${agentsMd.path}  (${agentsMd.bytes} bytes${agentsMd.overLimit ? ` — WARNING: over ${AGENTS_MD_BYTE_LIMIT} bytes; Codex truncates AGENTS.md there` : ""})`,
    ...(agentsMd.backupPath === undefined
      ? []
      : [
          `  the file there was not written by jig; on --write it is kept as ${agentsMd.backupPath}`,
        ]),
    `  rules/common rendered in (${agentsMd.commonFiles.length}): ${agentsMd.commonFiles.length === 0 ? "(none yet)" : agentsMd.commonFiles.join(", ")}`,
    "--- AGENTS.md (generated) ---",
    agentsMd.content.trimEnd(),
  ];

  const missingRule = agentsMd.skipped.filter((skipped) => skipped.missingRule);
  if (missingRule.length > 0) {
    lines.push(
      "",
      `  WARNING: ${missingRule.length} accepted decision note(s) carry no \`rule:\` line and are NOT bound:`,
      ...missingRule.map((skipped) => `    - ${skipped.file}`),
      "    A human writes that line at the time of the ruling; the generator never invents it.",
    );
  }
  const other = agentsMd.skipped.filter((skipped) => !skipped.missingRule);
  if (other.length > 0) {
    lines.push(
      `  (${other.length} not rendered: ${other.map((s) => `${s.file} — ${s.reason}`).join("; ")})`,
    );
  }
  return lines;
}

/** One line per single symlink destination: the state, and for replace/backup what is there now. */
function linkLines(report: ClaudeApplyReport): readonly string[] {
  return [
    `links (${report.links.length}):`,
    ...report.links.map((link) => linkLine(basename(link.path), link)),
    "  A symlink elsewhere is replaced (what it pointed at is untouched); a file or a real",
    "  directory is renamed aside, never deleted.",
  ];
}

/** The words one managed-directory section needs: what its entries are called, and what makes one. */
interface ManagedDirWording {
  /** Stem of the entry noun, e.g. `skill director` → `skill directory` / `skill directories`. */
  readonly noun: string;
  readonly singular: string;
  readonly plural: string;
  /** Parenthetical after the count: what qualifies an entry. */
  readonly how: string;
  /** Printed after the entries when any is foreign: who else writes here, and that jig leaves it. */
  readonly foreignNote?: readonly string[];
}

/**
 * One managed directory: itself, then its entries — planned, stale, or
 * somebody else's — then the source entries that get no link and why. The
 * three sections (`skills`, `agents`, `rules`) share this shape so a reader
 * learns it once.
 */
function managedDirLines(
  label: string,
  dir: ManagedDirReport,
  wording: ManagedDirWording,
): readonly string[] {
  const count = dir.selection.linked.length;
  const lines: string[] = [
    `${label} directory: ${describeLink(dir.plan)}  ${dir.path}`,
    `  ${count} ${wording.noun}${count === 1 ? wording.singular : wording.plural} to link (${wording.how}):`,
  ];
  if (dir.entries.length === 0) lines.push("    (none)");
  // Entry names (a skill's, or Claude Code's `.bucket-<uuid>` marker) can run past the
  // default column; the label is `"  " + name`, plus one space so the columns never touch.
  const width = Math.max(PAD, ...dir.entries.map((entry) => entry.name.length + 3));
  for (const entry of dir.entries) {
    switch (entry.kind) {
      case "link":
        lines.push(linkLine(`  ${entry.name}`, entry.plan, width));
        break;
      case "stale":
        lines.push(
          `    ${entry.name.padEnd(width - 2)}remove (${describeStaleReason(entry.reason)} → ${entry.target})`,
        );
        break;
      case "foreign":
        lines.push(`    ${entry.name.padEnd(width - 2)}left alone (not jig's: ${entry.what})`);
        break;
    }
  }
  if (wording.foreignNote !== undefined && dir.entries.some((entry) => entry.kind === "foreign")) {
    lines.push(...wording.foreignNote.map((line) => `  ${line}`));
  }
  const excludedWidth = Math.max(
    PAD,
    ...dir.selection.excluded.map((entry) => entry.name.length + 3),
  );
  lines.push(
    `  not linked (${dir.selection.excluded.length}):`,
    ...dir.selection.excluded.map(
      (entry) => `    ${entry.name.padEnd(excludedWidth - 2)}${entry.reason}`,
    ),
  );
  return lines;
}

/** The retired directory: removed when it holds only pointers, a conflict when it holds files. */
function commandsLines(report: ClaudeApplyReport): readonly string[] {
  const { commands } = report;
  switch (commands.action.kind) {
    case "absent":
      return [`commands: absent  ${commands.path}  (retired: commands are skills)`];
    case "remove":
      return [
        `commands: remove  ${commands.path}  (${commands.action.reason})`,
        "  Retired: commands are skills (rules/decisions/2026-09-22-commands-are-skills.md).",
      ];
    case "conflict":
      return [
        `commands: CONFLICT  ${commands.path}  (${commands.action.reason})`,
        "  Retired: commands are skills. jig removes only a symlink or a directory of symlinks;",
        "  this one holds real files, so it is left exactly as it is.",
      ];
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}

/** The `mcpServers` change in ~/.claude.json: what is added, changed, removed, and left alone. */
function mcpLines(report: ClaudeApplyReport): readonly string[] {
  const { mcp } = report;
  const list = (label: string, names: readonly string[]) =>
    names.length === 0 ? [] : [`  ${label}: ${names.join(", ")}`];
  return [
    `mcp servers (${mcp.path}, mcpServers only): ${mcp.outcome}`,
    ...list("add", mcp.added),
    ...list("update", mcp.changed),
    ...list("remove (jig wrote it; no longer in mcp/servers.json)", mcp.removed),
    ...list("left alone (not jig's)", mcp.others),
    ...(mcp.reason === undefined ? [] : [`  ${mcp.reason}`]),
  ];
}

/** The sandbox block's provenance and its cost, both stated. */
function sandboxLines(report: ClaudeApplyReport): readonly string[] {
  const excluded = (report.composition.settings.sandbox as { excludedCommands?: unknown })
    ?.excludedCommands;
  const list = Array.isArray(excluded) ? excluded : [];
  const provenance =
    report.sandboxSourcePath === undefined
      ? "sandbox: host mode, strict. NO policy/sandbox.json — excludedCommands defaults to empty (the tightest answer; create the file to choose)."
      : `sandbox: host mode, strict. excludedCommands copied from ${report.sandboxSourcePath}: ${list.length === 0 ? "(none)" : list.join(", ")}`;
  return [
    provenance,
    "  An excluded command runs outside the OS sandbox but still goes through jig's guard.",
    "  What an empty list costs on macOS, per the sandboxing doc:",
    ...KNOWN_MACOS_EXCLUSION_CANDIDATES.map((candidate) => `    - ${candidate}`),
  ];
}

/**
 * The Codex target's dry-run, in the Claude target's order: the managed
 * skills mount and what `~/.codex/skills` holds (reported, not managed), the
 * generated AGENTS.md (as a diff — its text is the Claude target's, printed
 * there), the generated agent files with the model question answered per
 * tier, config.toml's block with its conflicts and yoki's leftovers, and the
 * one file that is `jig codex register`'s.
 */
function formatCodex(report: CodexApplyReport, dest: string): string {
  const lines: string[] = [
    "== codex ==",
    `outcome: ${report.outcome}`,
    `dest: ${dest}`,
    ...(report.message === undefined ? [] : [`message: ${report.message}`]),
    "",
    ...agentsSkillsMountLines(report.agentsSkillsDir),
    "",
    ...codexSkillsLines(report),
    "",
    ...codexAgentsMdLines(report),
    "",
    ...agentFileLines(report),
    "",
    ...configTomlLines(report),
    "",
    `hooks.json: not touched  ${report.hooksJson}  (jig codex register's; run that to change the guard hook)`,
  ];
  return lines.join("\n");
}

/**
 * `~/.agents/skills`: the one directory three targets deliver. The section
 * names them all and the one that planned this run, so a reader of any
 * dry-run knows the others will find the same links `ok`.
 */
function agentsSkillsMountLines(mount: AgentsSkillsMountReport): readonly string[] {
  const flags = AGENTS_SKILLS_MOUNT_TARGETS.map((target) => `--target ${target}`);
  const targets = `${flags.slice(0, -1).join(", ")} and ${flags[flags.length - 1]}`;
  return [
    ...managedDirLines("skills (cross-harness)", mount, {
      noun: "skill director",
      plural: "ies",
      singular: "y",
      how: "each holds a SKILL.md; Codex, pi and omp read this directory",
    }),
    `  Delivered by ${targets} alike, from one plan (this run: --target ${mount.target}); the others find the same links ok.`,
  ];
}

/**
 * `~/.codex/skills`: not a destination. Codex reads every skill from
 * `~/.agents/skills` like pi and omp, and the Codex-specific ports are
 * gone, so the directory is listed for the hand cleanup of milestone 4 and
 * nothing in it is planned.
 */
function codexSkillsLines(report: CodexApplyReport): readonly string[] {
  const { codexSkills } = report;
  const lines = [
    `codex skills: not managed by jig  ${codexSkills.path}`,
    "  Codex reads every skill from ~/.agents/skills (above), as pi and omp do; the codex/SKILL.md ports",
    "  are dropped, so nothing is delivered here and nothing here is removed.",
  ];
  if (codexSkills.state.kind !== "dir") {
    lines.push(
      `  yoki leftovers (milestone 4) — not managed by jig: (${describePathState(codexSkills.state)})`,
    );
    return lines;
  }
  if (codexSkills.entries.length === 0) {
    lines.push(
      "  yoki leftovers (milestone 4) — not managed by jig: (none; the directory is empty)",
    );
    return lines;
  }
  const width = Math.max(PAD, ...codexSkills.entries.map((entry) => entry.name.length + 3));
  lines.push(
    `  yoki leftovers (milestone 4) — not managed by jig (${codexSkills.entries.length}), clean by hand:`,
    ...codexSkills.entries.map(
      (entry) => `    ${entry.name.padEnd(width - 2)}${entry.what}  — ${entry.note}`,
    ),
  );
  return lines;
}

/** The generated file's outcome and size, then the diff against what stands there; its text is the Claude target's. */
function codexAgentsMdLines(report: CodexApplyReport): readonly string[] {
  const { agentsMd } = report;
  return [
    `AGENTS.md: ${agentsMd.outcome}  ${agentsMd.path}  (${agentsMd.bytes} bytes${agentsMd.overLimit ? ` — WARNING: over ${AGENTS_MD_BYTE_LIMIT} bytes; Codex truncates AGENTS.md there` : ""})`,
    "  the same generated content as ~/.claude/AGENTS.md — one source, two destinations",
    ...(agentsMd.backupPath === undefined
      ? []
      : [
          `  the file there was not written by jig; on --write it is kept as ${agentsMd.backupPath}`,
        ]),
    `  rules/common rendered in (${agentsMd.commonFiles.length}): ${agentsMd.commonFiles.length === 0 ? "(none yet)" : agentsMd.commonFiles.join(", ")}`,
    ...(agentsMd.diff === ""
      ? ["  (no differences)"]
      : ["--- diff (current vs generated) ---", agentsMd.diff]),
  ];
}

function describeModel(file: AgentFileReport): string {
  return describeModelChoice(file.model, "Codex id");
}

/**
 * One phrase per answer to the model question; `what` names the harness's
 * kind of id. A mapped answer says where it came from — the tier, or the
 * agent's own `models:` override — and the effort when one rides along.
 */
function describeModelChoice(model: ModelChoice, what: string): string {
  switch (model.kind) {
    case "mapped": {
      const effort = model.reasoningEffort === undefined ? "" : ` effort=${model.reasoningEffort}`;
      const from =
        model.override === true
          ? `models: override${model.tier === undefined ? "" : `, tier ${model.tier}`}`
          : (model.tier ?? "");
      return `model: ${model.model}${effort} (${from})`;
    }
    case "inherit":
      return "model: (none: inherits)";
    case "unmapped":
      return `model: (none: no ${what} for "${model.tier}")`;
  }
}

/** One line per generated agent file, then what stands in the directory that no source produces. */
function agentFileLines(report: CodexApplyReport): readonly string[] {
  const { agents } = report;
  const width = Math.max(PAD, ...agents.files.map((file) => file.name.length + 3));
  const lines = [
    `agents (generated files): ${agents.path}`,
    `  ${agents.files.length} agent definition${agents.files.length === 1 ? "" : "s"} → <name>.toml (name, description, model, model_reasoning_effort, developer_instructions; tools folded into the instructions):`,
  ];
  if (agents.files.length === 0) lines.push("    (none)");
  for (const file of agents.files) {
    lines.push(
      `    ${file.name.padEnd(width - 2)}${file.outcome.padEnd(10)}${describeModel(file)}${file.backupPath === undefined ? "" : `  (not jig's yet → kept as ${basename(file.backupPath)})`}`,
    );
  }
  const source = agents.mappingSource === undefined ? "agents/models.json" : agents.mappingSource;
  if (agents.mappedTiers.length > 0) {
    lines.push(
      `  model tiers mapped by ${source} (${agents.mappedTiers.map((t) => `${t.tier} → ${t.model}${t.reasoningEffort === undefined ? "" : ` ${t.reasoningEffort}`}: ${t.count}`).join(", ")});`,
      "  model_reasoning_effort is written where the mapping carries one.",
    );
  }
  if (agents.unmappedTiers.length > 0) {
    lines.push(
      `  model tiers with no Codex id in ${source} (${agents.unmappedTiers.map((t) => `${t.tier}: ${t.count}`).join(", ")}): \`model\` is left out and Codex`,
      "  applies its default. A mapping is a ruling, recorded in that file, never a guess here.",
    );
  }
  if (agents.excluded.length > 0) {
    lines.push(
      `  not generated (${agents.excluded.length}):`,
      ...agents.excluded.map((entry) => `    ${entry.name.padEnd(PAD - 2)}${entry.reason}`),
    );
  }
  if (agents.foreign.length > 0) {
    lines.push(
      `  not jig's (${agents.foreign.length}), left alone:`,
      ...agents.foreign.map((entry) => `    ${entry.name.padEnd(width - 2)}${entry.what}`),
    );
  }
  return lines;
}

/** jig's MCP block: the servers, the conflicts that stop a write, yoki's leftovers, and the diff. */
function configTomlLines(report: CodexApplyReport): readonly string[] {
  const { configToml } = report;
  const lines = [
    `config.toml: ${configToml.outcome}  ${configToml.path}`,
    `  mcp servers in jig's block (${configToml.servers.length}): ${configToml.servers.length === 0 ? "(none)" : configToml.servers.join(", ")}`,
    "  every other table in the file is carried through byte for byte.",
  ];
  if (configToml.declaredOutside.length > 0) {
    lines.push(
      `  CONFLICT: ${configToml.declaredOutside.length} of them already declared outside jig's block — a duplicate table stops Codex`,
      "  from loading its config, so nothing is written until these are removed by hand (a one-time cleanup):",
      ...configToml.declaredOutside.map(
        (table) => `    [mcp_servers.${table.name}]  line ${table.line}`,
      ),
    );
  }
  if (configToml.yokiLeftovers.length > 0) {
    lines.push(
      `  yoki leftovers (${configToml.yokiLeftovers.length}), left alone until milestone 4:`,
      ...configToml.yokiLeftovers.map((leftover) => `    ${leftover}`),
    );
  }
  lines.push(
    ...(configToml.diff === ""
      ? ["  (no differences)"]
      : ["--- diff (current vs generated) ---", configToml.diff]),
  );
  return lines;
}

/**
 * The omp target's dry-run, in the Codex target's order: the shared skills
 * mount, the generated agent files with the model and tool questions
 * answered per file, mcp.json's entries with what is carried through, the
 * extension link beside the directory's other entries, yoki's leftovers
 * under their own heading, and what reaches omp natively — including the
 * one gap this milestone leaves.
 */
function formatOmp(report: OmpApplyReport, paths: OmpApplyPaths): string {
  const lines: string[] = [
    "== omp ==",
    `outcome: ${report.outcome}`,
    `dest: ${paths.agentDir}`,
    ...(report.message === undefined ? [] : [`message: ${report.message}`]),
    "",
    ...agentsSkillsMountLines(report.agentsSkillsDir),
    "",
    ...ompAgentFileLines(report),
    "",
    ...mcpJsonLines(report),
    "",
    ...extensionLines(report),
    "",
    ...ompLeftoverLines(report),
    "",
    "reaches omp natively, nothing to deliver:",
    `  skills       ${paths.agentsSkills} (omp's \`agents\` provider reads ~/.agents/skills; ~/.claude/skills through its \`claude\` provider)`,
    `  instructions ${paths.home}/.claude/CLAUDE.md → AGENTS.md (omp's \`claude\` provider; a ${paths.agentDir}/AGENTS.md would shadow it, and jig writes none)`,
    "  language guidance: inside the language skills (skills/<lang>-*), carried by the mount above —",
    "  no separate rules delivery (rules/decisions/2026-09-23-language-rules-fold-into-skills.md).",
  ];
  return lines.join("\n");
}

function describeOmpTools(file: OmpAgentFileReport): string {
  const kept =
    file.tools.tools.length === 0
      ? "(none: omp's default set)"
      : `[${file.tools.tools.join(", ")}]`;
  const dropped =
    file.tools.unmapped.length === 0 ? "" : `  dropped: ${file.tools.unmapped.join(", ")}`;
  return `tools: ${kept}${dropped}`;
}

/** One line per generated agent file, then the two gaps counted, then what stands there that no source produces. */
function ompAgentFileLines(report: OmpApplyReport): readonly string[] {
  const { agents } = report;
  const width = Math.max(PAD, ...agents.files.map((file) => file.name.length + 3));
  const lines = [
    `agents (generated files): ${agents.path}`,
    `  ${agents.files.length} agent definition${agents.files.length === 1 ? "" : "s"} → <name>.md (omp's own frontmatter: name, description, model, tools; body verbatim):`,
  ];
  if (agents.files.length === 0) lines.push("    (none)");
  for (const file of agents.files) {
    lines.push(
      `    ${file.name.padEnd(width - 2)}${file.outcome.padEnd(10)}${describeModelChoice(file.model, "omp selector")}  ${describeOmpTools(file)}${file.backupPath === undefined ? "" : `  (not jig's yet → kept as ${basename(file.backupPath)})`}`,
    );
  }
  if (agents.unmappedTiers.length > 0) {
    lines.push(
      `  model tiers with no omp selector (${agents.unmappedTiers.map((t) => `${t.tier}: ${t.count}`).join(", ")}): \`model\` is left out and omp`,
      "  applies its task default. omp wants a provider-qualified selector or a modelRoles alias; the `omp`",
      "  table of agents/models.json is empty until ruled, and a mapping is a ruling, never a guess.",
    );
  }
  if (agents.unmappedTools.length > 0) {
    lines.push(
      `  Claude tools with no omp tool (${agents.unmappedTools.map((t) => `${t.tool}: ${t.count}`).join(", ")}): left out of \`tools\`,`,
      "  which only narrows the agent (omp: packages/coding-agent/src/tools/builtin-names.ts).",
    );
  }
  if (agents.excluded.length > 0) {
    lines.push(
      `  not generated (${agents.excluded.length}):`,
      ...agents.excluded.map((entry) => `    ${entry.name.padEnd(PAD - 2)}${entry.reason}`),
    );
  }
  if (agents.foreign.length > 0) {
    lines.push(
      `  not jig's (${agents.foreign.length}), left alone:`,
      ...agents.foreign.map((entry) => `    ${entry.name.padEnd(width - 2)}${entry.what}`),
    );
  }
  return lines;
}

/** jig's entries, what is carried through, the conflict that stops a write, and the diff. */
function mcpJsonLines(report: OmpApplyReport): readonly string[] {
  const { mcpJson } = report;
  const lines = [
    `mcp.json: ${mcpJson.outcome}  ${mcpJson.path}`,
    `  jig's mcpServers entries (${mcpJson.servers.length}): ${mcpJson.servers.length === 0 ? "(none)" : mcpJson.servers.join(", ")}`,
    "  omp's MCP client is lazy (xdev), so the full targets.omp list is delivered (mcp-list decision).",
  ];
  if (mcpJson.invalid !== undefined) {
    lines.push(
      `  CONFLICT: the file could not be read as a JSON object (${mcpJson.invalid}); nothing can be carried`,
      "  through, so nothing is written until it is fixed by hand.",
    );
  }
  if (mcpJson.foreign.length > 0) {
    lines.push(
      `  entries no source produces (${mcpJson.foreign.length}), carried through as they are: ${mcpJson.foreign.join(", ")}`,
    );
  }
  if (mcpJson.carried.length > 0) {
    lines.push(`  other top-level keys carried through: ${mcpJson.carried.join(", ")}`);
  }
  lines.push(
    "  Hand-edit detection compares jig's entries, not the file: omp writes here itself (/mcp add). A",
    "  `/mcp disable` on a jig server edits the entry and is a conflict; `disabledServers` is carried through.",
    ...(mcpJson.diff === ""
      ? ["  (no differences)"]
      : ["--- diff (current vs generated) ---", mcpJson.diff]),
  );
  return lines;
}

/** The one link, then the directory's other entries: yoki's, and not jig's. */
function extensionLines(report: OmpApplyReport): readonly string[] {
  const { extensions } = report;
  const width = Math.max(
    PAD,
    ...[...extensions.yokiLeftovers, ...extensions.foreign].map((entry) => entry.name.length + 3),
  );
  const lines = [
    `extensions: ${extensions.path}${extensions.dirState.kind === "missing" ? "  (created on --write)" : extensions.dirState.kind === "file" ? "  CONFLICT: a regular file" : ""}`,
    linkLine(basename(extensions.link.path), extensions.link, width),
    "  omp loads *.ts in this directory directly, symlinks included (docs/extension-loading.md); the",
    "  extension carries the guard, the session record, the formatter and the stop gate (adapters/omp/README.md).",
    "  Disable it with `disabledExtensions: [extension-module:jig]` in config.yml, not by removing the link.",
  ];
  if (extensions.yokiLeftovers.length > 0) {
    lines.push(
      `  yoki leftovers (milestone 4) (${extensions.yokiLeftovers.length}), left alone:`,
      ...extensions.yokiLeftovers.map(
        (entry) => `    ${entry.name.padEnd(width - 2)}${entry.what}`,
      ),
    );
  }
  if (extensions.foreign.length > 0) {
    lines.push(
      `  not jig's (${extensions.foreign.length}), left alone:`,
      ...extensions.foreign.map((entry) => `    ${entry.name.padEnd(width - 2)}${entry.what}`),
    );
  }
  return lines;
}

/** What yoki left under the agent directory, each with why jig leaves it. */
function ompLeftoverLines(report: OmpApplyReport): readonly string[] {
  const { yokiLeftovers } = report;
  if (yokiLeftovers.length === 0) {
    return ["yoki leftovers (milestone 4): (none found under the agent directory)"];
  }
  const width = Math.max(PAD, ...yokiLeftovers.map((entry) => entry.name.length + 3));
  return [
    `yoki leftovers (milestone 4) (${yokiLeftovers.length}), left alone:`,
    ...yokiLeftovers.map(
      (entry) => `  ${entry.name.padEnd(width)}${entry.what.padEnd(16)}${entry.note}`,
    ),
  ];
}

/**
 * The pi target's agent-directory half, in the omp target's order: the
 * shared skills mount, the generated AGENTS.md over the symlink standing
 * there today (with the source-side cleanup it leaves), pi-mcp-adapter's
 * config with what is carried through, the two packages the delivery
 * relies on with the paste-able line for each that is missing, the
 * extensions directory as manager.sh leaves it, and the two gaps.
 */
function formatPi(report: PiApplyReport, paths: PiApplyPaths): string {
  const lines: string[] = [
    "== pi (agent directory) ==",
    `outcome: ${report.outcome}`,
    `dest: ${paths.agentDir}`,
    ...(report.message === undefined ? [] : [`message: ${report.message}`]),
    "",
    ...agentsSkillsMountLines(report.agentsSkillsDir),
    `  pi reads this directory natively (docs skills.md: "Pi also supports the Agent Skills locations ~/.agents/skills/"); no ${paths.agentDir}/skills is created.`,
    "",
    ...piAgentsMdLines(report),
    "",
    ...piMcpLines(report),
    "",
    ...piPackageLines(report),
    "",
    ...piExtensionLines(report),
    "",
    'subagents: GAP — pi has none natively (rules/research/2026-09-22-multi-lane-review-per-harness.md: "Pi itself remains',
    "  fundamentally single-agent\"). The subagents decision's answer: a workflow script is written once, in Claude",
    "  Code's syntax; pi runs it through tintinweb/pi-subagents when that package is installed (see packages above).",
    "rules: language guidance is not a separate delivery — it lives in the language skills (skills/<lang>-*),",
    "  which the mount above carries (rules/decisions/2026-09-23-language-rules-fold-into-skills.md).",
  ];
  return lines.join("\n");
}

/** The generated file over the link, the diff, and the repo file it leaves unused. */
function piAgentsMdLines(report: PiApplyReport): readonly string[] {
  const { agentsMd, retiredAgentsMd } = report;
  const lines = [
    `AGENTS.md: ${agentsMd.outcome}  ${agentsMd.path}  (${agentsMd.bytes} bytes${agentsMd.overLimit ? ` — WARNING: over ${AGENTS_MD_BYTE_LIMIT} bytes; Codex truncates AGENTS.md there` : ""})`,
    "  the same generated content as ~/.claude/AGENTS.md — one source, one file for all five harnesses",
    "  (config-layout decision, 2026-09-24 consequence); pi reads <agent-dir>/AGENTS.md (docs configuration.md).",
    ...(agentsMd.replacesSymlink === undefined
      ? []
      : [
          `  a symlink stands there today (→ ${agentsMd.replacesSymlink}); on --write the link is replaced by the`,
          "  generated regular file — a pointer, so nothing is backed up, and what it pointed at is untouched.",
        ]),
    ...(agentsMd.backupPath === undefined
      ? []
      : [
          `  the file there was not written by jig; on --write it is kept as ${agentsMd.backupPath}`,
        ]),
    `  rules/common rendered in (${agentsMd.commonFiles.length}): ${agentsMd.commonFiles.length === 0 ? "(none yet)" : agentsMd.commonFiles.join(", ")}`,
    ...(agentsMd.diff === ""
      ? ["  (no differences)"]
      : ["--- diff (current vs generated) ---", agentsMd.diff]),
  ];
  if (retiredAgentsMd.state.kind !== "missing") {
    lines.push(
      `  source-side cleanup (yours, not jig's): ${retiredAgentsMd.path} is ${describePathState(retiredAgentsMd.state)}`,
      "  and unused once the generated file lands — pi's short AGENTS.md retires. jig does not delete repository",
      "  files; remove it by hand, and drop AGENTS.md from core/config/manager.sh link_pi_resources, which would",
      "  otherwise put the symlink back on its next run (milestone 4 retires the whole function).",
    );
  }
  return lines;
}

/** jig's entries in the adapter's shared config, what is carried through, the adapter's own override file, and the diff. */
function piMcpLines(report: PiApplyReport): readonly string[] {
  const { mcpJson } = report;
  const lines = [
    `mcp (pi-mcp-adapter): ${mcpJson.outcome}  ${mcpJson.path}`,
    `  jig's mcpServers entries (${mcpJson.servers.length}): ${mcpJson.servers.length === 0 ? "(none)" : mcpJson.servers.join(", ")}`,
    "  pi has no MCP client (rules/research/2026-09-22-mcp-pi-omp-and-usage-guidance.md §Q1); the MCP-list decision delivers",
    "  the list through the community extension pi-mcp-adapter, which reads this file as its user-global shared config",
    '  (README "File Layout") and connects lazily by default, so the full targets.pi list costs nothing until called.',
    "  Entries carry command/args/env or url/headers, no `type` (the adapter documents none; the transport is which is set).",
  ];
  if (mcpJson.invalid !== undefined) {
    lines.push(
      `  CONFLICT: the file could not be read as a JSON object (${mcpJson.invalid}); nothing can be carried`,
      "  through, so nothing is written until it is fixed by hand.",
    );
  }
  if (mcpJson.foreign.length > 0) {
    lines.push(
      `  entries no source produces (${mcpJson.foreign.length}), carried through as they are: ${mcpJson.foreign.join(", ")}`,
    );
  }
  if (mcpJson.carried.length > 0) {
    lines.push(`  other top-level keys carried through: ${mcpJson.carried.join(", ")}`);
  }
  lines.push(
    "  Hand-edit detection compares jig's entries, not the file. `/mcp disable` never edits this file (it writes",
    "  `disabled` into the project's .pi/mcp.json), so a `disabled` inside a jig entry here is a hand edit and a conflict.",
    `  ${mcpJson.adapterOverride.path}: ${mcpJson.adapterOverride.state.kind === "missing" ? "absent" : describePathState(mcpJson.adapterOverride.state)} — the adapter's own override file (higher precedence;`,
    "  a same-named server there wins over jig's); not jig's, never written.",
    ...(mcpJson.diff === ""
      ? ["  (no differences)"]
      : ["--- diff (current vs generated) ---", mcpJson.diff]),
  );
  return lines;
}

/** Report only: the two packages the delivery relies on, each present or with its paste-able lines. */
function piPackageLines(report: PiApplyReport): readonly string[] {
  const { packages } = report;
  const width = Math.max(PAD, ...packages.packages.map((entry) => entry.name.length + 3));
  const lines = [
    `packages (report only): ${packages.path}`,
    "  the source ~/.pi/agent/settings.json links to (manager.sh); `packages` is where `pi install` records a package",
    "  (docs packages.md). jig does not edit settings.json in this milestone.",
    ...(packages.invalid === undefined
      ? []
      : [
          `  WARNING: could not read it (${packages.invalid}); every package below reads as missing.`,
        ]),
  ];
  for (const entry of packages.packages) {
    if (entry.source !== undefined) {
      lines.push(`  ${entry.name.padEnd(width)}present (${entry.source})  — ${entry.role}`);
      continue;
    }
    lines.push(
      `  ${entry.name.padEnd(width)}MISSING  — ${entry.role}`,
      `    run once:               ${entry.installLine}`,
      `    or add to "packages":   ${entry.packagesEntry}`,
    );
  }
  return lines;
}

/** Report only: what manager.sh links here today, and everything else. */
function piExtensionLines(report: PiApplyReport): readonly string[] {
  const { extensions } = report;
  const width = Math.max(
    PAD,
    ...[...extensions.managerLinks, ...extensions.foreign].map((entry) => entry.name.length + 3),
  );
  const lines = [
    `extensions (report only): ${extensions.path}${extensions.dirState.kind === "missing" ? "  (absent)" : ""}`,
    `  delivered by core/config/manager.sh link_pi_resources until milestone 4 (${extensions.managerLinks.length}), links into next/home/shared/harness/pi/extensions/:`,
    ...(extensions.managerLinks.length === 0
      ? ["    (none)"]
      : extensions.managerLinks.map(
          (entry) => `    ${entry.name.padEnd(width - 2)}a symlink → ${entry.target}`,
        )),
  ];
  if (extensions.foreign.length > 0) {
    lines.push(
      `  not jig's (${extensions.foreign.length}), left alone:`,
      ...extensions.foreign.map((entry) => `    ${entry.name.padEnd(width - 2)}${entry.what}`),
    );
  }
  lines.push("  Nothing here is linked or unlinked by this milestone.");
  return lines;
}

/**
 * The DSH target's harness-home half, in the pi target's order: the
 * profiles found against the repo's, the MCP rows and the block per
 * profile with its conflicts and diff, the home-level patch layer, the
 * generated AGENTS.md against DSH's budget, then what reaches DSH
 * natively or through manager.sh — and the facts the delivery could not
 * verify, marked as such.
 */
function formatDsh(report: DshApplyReport, paths: DshApplyPaths): string {
  const lines: string[] = [
    "== dsh (harness home) ==",
    `outcome: ${report.outcome}`,
    `dest: ${paths.dshHome}  (${paths.dshHomeVia === "DSH_HOME" ? "DSH_HOME" : "default ~/.dsh; DSH_HOME overrides"})`,
    ...(report.message === undefined ? [] : [`message: ${report.message}`]),
    "",
    ...dshProfileLines(report, paths),
    "",
    ...dshMcpLines(report),
    "",
    ...dshAgentsMdLines(report, paths),
    "",
    ...dshReportOnlyLines(report, paths),
    "",
    "[unverified] — facts the delivery rests on that DSH's own docs did not settle:",
    "  - docs/config-catalog.md (the exhaustive field list) was not fetched (404 on raw main); the",
    "    dsh-mcp-client README's field table (0.1.5-rc.2, installed copy) is what is cited.",
    "  - a source `http`/`sse` server becomes `transport: streamable-http`, the only remote transport the",
    "    README documents; whether an SSE-only server answers it is untested (no dsh server uses either today).",
    "  - `!!js process.env.X` inside an inserted row's config: documented for entries (README) and for patch",
    "    files (dsh-app-boot README); the combination is not exercised — no dsh server carries `${VAR}` today.",
    "  - only `$DSH_HOME` is honoured; a home configured inside dsh's own settings (dsh-home-paths: 'an explicit",
    "    configured path has the highest precedence') is not read, because jig reads no dsh settings file.",
  ];
  return lines.join("\n");
}

/** The profiles: which are both scaffolded and the repo's, which are one but not the other. */
function dshProfileLines(report: DshApplyReport, paths: DshApplyPaths): readonly string[] {
  const lines = [
    `profiles: ${report.profilesDir.path}${report.profilesDir.state.kind === "dir" ? "" : `  (${describePathState(report.profilesDir.state)})`}`,
    `  a profile counts when DSH scaffolded it there AND the repo owns ${paths.repoProfilesDir}/<name>/cordis.patch.yml`,
    "  (the rule core/config/manager.sh link_dsh_resources applies); jig never creates a profile directory.",
  ];
  if (!report.scaffolded) {
    lines.push(
      "  DSH NOT SCAFFOLDED: no profile matches, so nothing is delivered — not the patch rows, not AGENTS.md",
      "  (which would create the home). Run dsh once (`dsh --profile <name>`) to scaffold, then apply again.",
    );
  } else {
    const width = Math.max(PAD, ...report.profiles.map((profile) => profile.name.length + 3));
    lines.push(
      `  delivered to (${report.profiles.length}):`,
      ...report.profiles.map(
        (profile) =>
          `    ${profile.name.padEnd(width - 2)}${profile.outcome.padEnd(10)}${profile.patchPath}`,
      ),
    );
  }
  if (report.notScaffolded.length > 0) {
    lines.push(
      `  in the repo, not scaffolded on this machine (${report.notScaffolded.length}): ${report.notScaffolded.join(", ")} — nothing delivered there`,
    );
  }
  if (report.foreignProfiles.length > 0) {
    lines.push(
      `  scaffolded, not the repo's (${report.foreignProfiles.length}), left alone: ${report.foreignProfiles.join(", ")}`,
    );
  }
  return lines;
}

/** One profile's block: what stands there, the conflicts that stop a write, the guard plugin, the diff. */
function dshProfileBlockLines(profile: DshProfileReport): readonly string[] {
  const lines = [
    `  ${profile.name}: ${profile.outcome}  ${profile.patchPath}${profile.state.kind === "missing" ? "  (absent: created with jig's block only; the repo's rows come from manager.sh)" : profile.state.kind === "file" ? "" : `  (${describePathState(profile.state)})`}`,
  ];
  if (profile.replacesEmptyLayer) {
    lines.push(
      "    the file holds only the scaffold's `[]` (an empty layer; a comments-only file fails boot): the block",
      "    takes its place, comments kept.",
    );
  }
  if (profile.invalid !== undefined) {
    lines.push(`    CONFLICT: ${profile.invalid}; nothing is written until it is fixed by hand.`);
  }
  if (profile.declaredOutside.length > 0) {
    lines.push(
      `    CONFLICT: ${profile.declaredOutside.length} of jig's rows already declared outside the block — a duplicate id fails`,
      "    DSH's boot and a duplicate serverName drops the later row, so nothing is written until reconciled by hand:",
      ...profile.declaredOutside.map((d) => `      ${d.kind} ${d.value}  line ${d.line}`),
    );
  }
  lines.push(
    `    guard plugin (report only): ${profile.guardPlugin.kind === "missing" ? "NOT linked into node_modules/@esh2n/jig-dsh-guard — the jig-guard row fails to load until manager.sh link_dsh_resources runs" : `linked (${describePathState(profile.guardPlugin)} at node_modules/@esh2n/jig-dsh-guard)`}`,
    ...(profile.diff === ""
      ? ["    (no differences)"]
      : ["    --- diff (current vs generated) ---", profile.diff]),
  );
  return lines;
}

/** jig's rows, what the block is, the per-profile plans, and the home-level layer. */
function dshMcpLines(report: DshApplyReport): readonly string[] {
  const { mcp, homePatch } = report;
  const lines = [
    `mcp (cordis.patch.yml, per profile): jig's rows (${mcp.rows.length}): ${mcp.rows.length === 0 ? "(none)" : mcp.rows.map((row) => row.id).join(", ")}`,
    '  DSH\'s MCP client is eager — "tool descriptions and input schemas enter every request" (dsh-mcp-client',
    "  README) — so only targets.dsh servers are delivered (MCP-list decision: serena, codebase-memory, context7).",
    "  Each is a plugin row of @deepseek-ai/dsh-mcp-client (serverName, transport stdio|streamable-http,",
    "  command/args/env or url/headers; {{HOME}} expanded — DSH reads paths literally) inside one `- insert:`",
    "  patch row between `# jig:begin mcp` and `# jig:end mcp`. Every other row — the repo's",
    "  agent-default-model and jig-guard rows, anything hand-added — is carried through byte for byte.",
    "  Hand-edit detection compares the block, not the file.",
  ];
  if (report.scaffolded) {
    for (const profile of report.profiles) lines.push(...dshProfileBlockLines(profile));
    lines.push(
      "  Until milestone 4, core/config/manager.sh link_dsh_resources overwrites each of these files with the",
      "  repo copy (install_expanded) on every run and drops the block: re-run `jig apply --target dsh --write`",
      "  after it (the block's absence reads as write, never as a conflict).",
    );
  }
  lines.push(
    `  ${homePatch.path}: ${homePatch.state.kind === "missing" ? "absent" : describePathState(homePatch.state)} — the home-level patch layer, applied after every`,
    "  profile's (dsh README \"Profiles\"); not jig's, never written. [unverified] whether one row there could",
    "  replace the per-profile rows for every profile at once — a ruling, not a guess here.",
    ...(homePatch.declaredOutside.length > 0
      ? [
          `  CONFLICT: it declares ${homePatch.declaredOutside.map((d) => `${d.kind} ${d.value} (line ${d.line})`).join(", ")} — a duplicate fails DSH's boot.`,
        ]
      : []),
  );
  return lines;
}

/** The generated file against DSH's chain budget; absent when nothing is delivered. */
function dshAgentsMdLines(report: DshApplyReport, paths: DshApplyPaths): readonly string[] {
  const { agentsMd } = report;
  if (agentsMd === undefined) {
    return [
      `AGENTS.md: not delivered  ${paths.agentsMd}  (DSH not scaffolded; the file would create the home)`,
    ];
  }
  const budget =
    agentsMd.bytes > DSH_INSTRUCTIONS_BUDGET_BYTES
      ? ` — WARNING: over dsh-base's ${DSH_INSTRUCTIONS_BUDGET_BYTES}-byte instruction budget; DSH omits the broadest file (this one) first`
      : ` of dsh-base's ${DSH_INSTRUCTIONS_BUDGET_BYTES}-byte budget for the whole instruction chain`;
  return [
    `AGENTS.md: ${agentsMd.outcome}  ${agentsMd.path}  (${agentsMd.bytes} bytes${budget})`,
    "  the same generated content as ~/.claude/AGENTS.md — one source, one file for all five harnesses",
    "  (config-layout decision); DSH reads the user-global $DSH_HOME/AGENTS.md first, then the project chain",
    "  (dsh-agent-instructions README; dsh-base enables it by default).",
    ...(agentsMd.backupPath === undefined
      ? []
      : [
          `  the file there was not written by jig; on --write it is kept as ${agentsMd.backupPath}`,
        ]),
    `  rules/common rendered in (${agentsMd.commonFiles.length}): ${agentsMd.commonFiles.length === 0 ? "(none yet)" : agentsMd.commonFiles.join(", ")}`,
    ...(agentsMd.diff === ""
      ? ["  (no differences)"]
      : ["--- diff (current vs generated) ---", agentsMd.diff]),
  ];
}

/** What reaches DSH natively, and what manager.sh still delivers. */
function dshReportOnlyLines(report: DshApplyReport, paths: DshApplyPaths): readonly string[] {
  const state = (entry: { readonly state: PathState }) =>
    entry.state.kind === "missing" ? "absent" : describePathState(entry.state);
  return [
    `skills (report only): ${report.agentsSkills.path}: ${state(report.agentsSkills)}${paths.agentsSkillsVia === "DSH_AGENTS_HOME" ? "  (DSH_AGENTS_HOME)" : ""}`,
    "  DSH reads ~/.agents/skills natively (dsh-skill-filesystem README: the user-agents root <agentsHome>/skills,",
    "  agentsHome = $DSH_AGENTS_HOME or ~/.agents, rank 500; <dshHome>/skills at rank 400). The mount is",
    "  --target codex/omp/pi's delivery (one plan, planAgentsSkillsMount); this target plans nothing there.",
    "",
    "delivered by core/config/manager.sh link_dsh_resources until milestone 4 (report only):",
    `  settings.yaml      ${report.settingsYaml.path}: ${state(report.settingsYaml)}  (link to the repo file the tiers half above writes)`,
    `  hooks.claude.json  ${report.hooksClaudeJson.path}: ${state(report.hooksClaudeJson)}  (expanded copy for the dsh-hooks-claude-code bridge; the profiles compose jig-guard instead)`,
    `  jig-guard plugin   ${paths.pluginDir}: build + link  (bun run build, then pnpm add link: per profile — see each profile above)`,
    "  language guidance: inside the language skills (skills/<lang>-*), carried by the skills mount —",
    "  no separate rules delivery (rules/decisions/2026-09-23-language-rules-fold-into-skills.md).",
  ];
}

export interface ClaudeCliContext {
  readonly ports: ClaudeApplyPorts;
  readonly paths: ClaudeApplyPaths;
  readonly hookPaths: ClaudeHookPaths;
}

export interface CodexCliContext {
  readonly ports: ClaudeApplyPorts;
  readonly paths: CodexApplyPaths;
  readonly options: CodexApplyOptions;
}

export interface OmpCliContext {
  readonly ports: ClaudeApplyPorts;
  readonly paths: OmpApplyPaths;
  readonly options: OmpApplyOptions;
}

export interface PiCliContext {
  readonly ports: ClaudeApplyPorts;
  readonly paths: PiApplyPaths;
}

export interface DshCliContext {
  readonly ports: ClaudeApplyPorts;
  readonly paths: DshApplyPaths;
}

export async function applyCli(
  args: readonly string[],
  ports: ApplyPorts,
  paths: { readonly tiersJsonPath: string; readonly destPaths: ApplyTargetPaths },
  claude?: ClaudeCliContext,
  codex?: CodexCliContext,
  omp?: OmpCliContext,
  pi?: PiCliContext,
  dsh?: DshCliContext,
): Promise<ApplyCliResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    return { stdout: `jig apply: ${parsed.error}\n`, code: 2 };
  }

  if (parsed.codex) {
    if (codex === undefined) {
      return { stdout: "jig apply: --target codex is not wired in this context\n", code: 2 };
    }
    const report = await applyCodex(
      { paths: codex.paths, options: codex.options, write: parsed.write },
      codex.ports,
    );
    return {
      stdout: `${formatCodex(report, dirOf(codex.paths.configToml))}\n`,
      code: report.outcome === "conflict" ? 1 : 0,
    };
  }

  if (parsed.claude) {
    if (claude === undefined) {
      return { stdout: "jig apply: --target claude is not wired in this context\n", code: 2 };
    }
    const report = await applyClaude(
      { paths: claude.paths, hookPaths: claude.hookPaths, write: parsed.write },
      claude.ports,
    );
    return {
      stdout: `${formatClaude(report, claude.paths.settings)}\n`,
      code: report.outcome === "conflict" ? 1 : 0,
    };
  }

  const report = await applyTiers(
    { tiersJsonPath: paths.tiersJsonPath, destPaths: paths.destPaths, options: parsed },
    ports,
  );

  const sections = report.results.map(formatResult);
  const hasBlockedWrite = report.results.some((r) => isBlockedWriteFailure(r, parsed.write));
  let code = report.hasConflict || hasBlockedWrite ? 1 : 0;

  // `--target omp` names the harness, so the agent-directory half follows the
  // tiers half (omp/models.yml's proxy block) in the same run, as for pi.
  if (parsed.omp) {
    if (omp === undefined) {
      sections.push(
        "== omp (agent directory) ==\nnot wired in this context: only omp/models.yml (above) was considered",
      );
    } else {
      const ompReport = await applyOmp(
        { paths: omp.paths, options: omp.options, write: parsed.write },
        omp.ports,
      );
      sections.push(formatOmp(ompReport, omp.paths));
      if (ompReport.outcome === "conflict") code = 1;
    }
  }

  // `--target pi` names the harness, so the agent-directory half follows the
  // tiers half in the same run. Not wired (tests, older composition roots):
  // the tiers half stands alone and says so.
  if (parsed.pi) {
    if (pi === undefined) {
      sections.push(
        "== pi (agent directory) ==\nnot wired in this context: only pi/models.json (above) was considered",
      );
    } else {
      const piReport = await applyPi({ paths: pi.paths, write: parsed.write }, pi.ports);
      sections.push(formatPi(piReport, pi.paths));
      if (piReport.outcome === "conflict") code = 1;
    }
  }

  // `--target dsh` names the harness too: the harness-home half follows the
  // tiers half, on the pi target's pattern.
  if (parsed.dsh) {
    if (dsh === undefined) {
      sections.push(
        "== dsh (harness home) ==\nnot wired in this context: only dsh/settings.yaml (above) was considered",
      );
    } else {
      const dshReport = await applyDsh({ paths: dsh.paths, write: parsed.write }, dsh.ports);
      sections.push(formatDsh(dshReport, dsh.paths));
      if (dshReport.outcome === "conflict") code = 1;
    }
  }

  return { stdout: `${sections.join("\n\n")}\n`, code };
}
