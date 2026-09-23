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
 * - **codex** — `~/.agents/skills` and `~/.codex/skills` as managed
 *   directories of links, the same generated AGENTS.md into `~/.codex`, one
 *   generated `~/.codex/agents/<name>.toml` per agent, and jig's MCP block
 *   in `~/.codex/config.toml` (`app/apply/apply-codex.ts`). Milestone 3a.
 * - **omp** — the same `~/.agents/skills`, one generated
 *   `~/.omp/agent/agents/<name>.md` per agent, jig's entries in
 *   `~/.omp/agent/mcp.json`, and the `extensions/jig.ts` link to jig's omp
 *   extension (`app/apply/apply-omp.ts`). Milestone 3b.
 *
 * `--target all` means the first group only. The claude, codex and omp
 * targets write into `$HOME` rather than into the checkout, so each has to
 * be named: a verb that reaches a user's live harness configuration by
 * default is one keystroke from a surprise, and nothing about the word
 * "all" says which files it means.
 */

import {
  type ClaudeApplyPaths,
  type ClaudeApplyReport,
  type LinkReport,
  type ManagedDirReport,
  applyClaude,
} from "../app/apply/apply-claude";
import {
  type AgentFileReport,
  type CodexApplyOptions,
  type CodexApplyPaths,
  type CodexApplyReport,
  applyCodex,
  yokiCommandLeftovers,
} from "../app/apply/apply-codex";
import {
  type OmpAgentFileReport,
  type OmpApplyOptions,
  type OmpApplyPaths,
  type OmpApplyReport,
  applyOmp,
} from "../app/apply/apply-omp";
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
import { describeStaleReason } from "../domain/claude/managed-dir";
import { DEFAULT_PERMITS, defaultPermitPolicyFragment } from "../domain/claude/permits";
import { KNOWN_MACOS_EXCLUSION_CANDIDATES } from "../domain/claude/sandbox";
import { NO_CODEX_PORT_REASON } from "../domain/codex/skills";

export interface ApplyCliResult {
  readonly stdout: string;
  readonly code: number;
}

interface ParsedArgs {
  readonly targets: readonly ApplyTarget[];
  readonly claude: boolean;
  readonly codex: boolean;
  readonly omp: boolean;
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
  const none = { targets: [], claude: false, codex: false, omp: false, write };
  if (targetName === "claude") return { ...none, claude: true };
  if (targetName === "codex") return { ...none, codex: true };
  if (targetName === "omp") return { ...none, omp: true };
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
  );
  return lines.join("\n");
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
  /**
   * An exclusion reason that is the expected case rather than news — for
   * `~/.codex/skills`, every skill without a port. Entries excluded for it
   * are counted on one line instead of listed, so the list keeps the ones
   * worth reading.
   */
  readonly summarizeExcluded?: string;
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
  const listed = dir.selection.excluded.filter(
    (entry) => entry.reason !== wording.summarizeExcluded,
  );
  const summarized = dir.selection.excluded.length - listed.length;
  const excludedWidth = Math.max(PAD, ...listed.map((entry) => entry.name.length + 3));
  lines.push(
    `  not linked (${dir.selection.excluded.length}):`,
    ...listed.map((entry) => `    ${entry.name.padEnd(excludedWidth - 2)}${entry.reason}`),
    ...(summarized > 0
      ? [
          `    (${summarized} ${summarized === 1 ? "entry" : "entries"}) ${wording.summarizeExcluded}`,
        ]
      : []),
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

/**
 * The MCP servers, printed instead of written — the same delivery as the
 * permit fragment. settings.json is not an MCP source; the user-scope one is
 * `~/.claude.json`, which only `claude mcp add` writes and jig never reads, so
 * the section is a paste-able block plus the one thing jig cannot list.
 */
function mcpLines(report: ClaudeApplyReport): readonly string[] {
  const { mcpAdds } = report;
  return [
    `mcp servers (claude mcp, user scope) (${mcpAdds.length}):`,
    "  Claude Code does not read MCP servers from settings.json (docs: mcp.md); its user-scope",
    "  source is ~/.claude.json, which only `claude mcp add` writes and jig never reads or writes.",
    "  Paste and run these once; they register every targets.claude server from mcp/servers.json:",
    ...(mcpAdds.length === 0 ? ["  (none)"] : mcpAdds.map((add) => `  ${add.line}`)),
    "",
    "  A server registered in ~/.claude.json but absent from mcp/servers.json is removed by hand",
    "  with `claude mcp remove --scope user <name>`; jig does not read ~/.claude.json, so it cannot",
    "  list those — `claude mcp list` shows every source with its scope.",
    "  --write does not run these lines: jig never invokes the claude CLI (whether it may is a",
    "  ruling not yet made), so --write performs the settings.json change only. Run the lines",
    "  above once; re-run them after editing mcp/servers.json.",
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
 * The Codex target's dry-run, in the Claude target's order: the two managed
 * skill directories, the generated AGENTS.md (as a diff — its text is the
 * Claude target's, printed there), the generated agent files with the model
 * question answered per tier, config.toml's block with its conflicts and
 * yoki's leftovers, and the one file that is `jig codex register`'s.
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
 * `~/.agents/skills`: the one directory two targets deliver. The section
 * names both and the one that planned this run, so a reader of either
 * dry-run knows the other will find the same links `ok`.
 */
function agentsSkillsMountLines(mount: AgentsSkillsMountReport): readonly string[] {
  const targets = AGENTS_SKILLS_MOUNT_TARGETS.map((target) => `--target ${target}`).join(" and ");
  return [
    ...managedDirLines("skills (cross-harness)", mount, {
      noun: "skill director",
      plural: "ies",
      singular: "y",
      how: "each holds a SKILL.md; Codex, pi and omp read this directory",
    }),
    `  Delivered by ${targets} alike, from one plan (this run: --target ${mount.target}); the other finds the same links ok.`,
  ];
}

/** `~/.codex/skills`: the ports, then yoki's `cmd-*` directories under their own heading. */
function codexSkillsLines(report: CodexApplyReport): readonly string[] {
  const leftovers = yokiCommandLeftovers(report.codexSkillsDir);
  const lines = [
    ...managedDirLines("codex skills", report.codexSkillsDir, {
      noun: "Codex port",
      plural: "s",
      singular: "",
      how: "skills/<name>/codex/SKILL.md; the link points at the port",
      foreignNote: [
        "Codex keeps its bundled skills in `.system/` here; that is not jig's and stays.",
      ],
      summarizeExcluded: NO_CODEX_PORT_REASON,
    }),
  ];
  if (leftovers.length > 0) {
    lines.push(
      `  yoki leftovers (${leftovers.length}) — real directories from yoki's command→skill conversion, redundant now that`,
      "  commands are skills delivered through ~/.agents/skills; jig removes links, never directories (milestone 4):",
      ...leftovers.map((leftover) => `    ${leftover.name}`),
    );
  }
  const ported = report.codexSkillsDir.selection.linked.length;
  if (ported > 0) {
    lines.push(
      "  Note: a ported skill is listed twice in Codex (here and in ~/.agents/skills); Codex does not merge",
      "  same-named skills (build-skills doc). Whether the generic entry should yield is a ruling, not a flag.",
    );
  }
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

/** One phrase per answer to the model question; `what` names the harness's kind of id. */
function describeModelChoice(model: ModelChoice, what: string): string {
  switch (model.kind) {
    case "mapped":
      return `model: ${model.model} (${model.tier})`;
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
    `  ${agents.files.length} agent definition${agents.files.length === 1 ? "" : "s"} → <name>.toml (name, description, developer_instructions; tools folded into the instructions):`,
  ];
  if (agents.files.length === 0) lines.push("    (none)");
  for (const file of agents.files) {
    lines.push(
      `    ${file.name.padEnd(width - 2)}${file.outcome.padEnd(10)}${describeModel(file)}${file.backupPath === undefined ? "" : `  (not jig's yet → kept as ${basename(file.backupPath)})`}`,
    );
  }
  if (agents.unmappedTiers.length > 0) {
    lines.push(
      `  model tiers with no Codex id (${agents.unmappedTiers.map((t) => `${t.tier}: ${t.count}`).join(", ")}): \`model\` is left out and Codex`,
      "  applies its default. jig has no source for Codex model ids; a mapping is a ruling, never a guess.",
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
    "  GAP: the conditional `paths:` rules (rules/<lang>/) are not delivered to omp in this milestone;",
    "  omp has no ~/.claude/rules reader, and jig's omp extension does not inject them yet.",
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
      "  applies its task default. omp wants a provider-qualified selector or a modelRoles alias; jig has no",
      "  source that maps Claude tiers to one, and a mapping is a ruling, never a guess.",
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

export async function applyCli(
  args: readonly string[],
  ports: ApplyPorts,
  paths: { readonly tiersJsonPath: string; readonly destPaths: ApplyTargetPaths },
  claude?: ClaudeCliContext,
  codex?: CodexCliContext,
  omp?: OmpCliContext,
): Promise<ApplyCliResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    return { stdout: `jig apply: ${parsed.error}\n`, code: 2 };
  }

  if (parsed.omp) {
    if (omp === undefined) {
      return { stdout: "jig apply: --target omp is not wired in this context\n", code: 2 };
    }
    const report = await applyOmp(
      { paths: omp.paths, options: omp.options, write: parsed.write },
      omp.ports,
    );
    return {
      stdout: `${formatOmp(report, omp.paths)}\n`,
      code: report.outcome === "conflict" ? 1 : 0,
    };
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

  const out = report.results.map(formatResult).join("\n\n");
  const hasBlockedWrite = report.results.some((r) => isBlockedWriteFailure(r, parsed.write));
  const code = report.hasConflict || hasBlockedWrite ? 1 : 0;

  return { stdout: `${out}\n`, code };
}
