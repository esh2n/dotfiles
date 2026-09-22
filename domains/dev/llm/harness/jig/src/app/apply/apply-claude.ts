/**
 * `jig apply --target claude` — deliver the Claude Code configuration from
 * the sources under `llm/harness/`, and either show what would change
 * (default) or do it (`--write`).
 *
 * Milestones 1 and 2 of the generator that retires `yoki-switch`, one
 * command:
 *
 * - `~/.claude/settings.json` (milestone 1): exactly `hooks`,
 *   `permissions.{allow,deny,defaultMode}`, `sandbox` and `mcpServers`, plus
 *   the absence of the retired harness's `env` keys.
 * - `~/.claude/AGENTS.md` (milestone 2): generated from `rules/common/` and
 *   `rules/decisions/`, with `CLAUDE.md` a relative symlink to it.
 * - `~/.claude/{skills,agents}` (milestone 2): symlinks into the harness.
 * - `~/.claude/rules/` (milestone 2): a real directory of per-language links,
 *   reconciled; `common/` is never linked because AGENTS.md carries it.
 * - `~/.claude/commands` (milestone 2): retired — commands are skills.
 *
 * `~/.claude/{hooks,scripts,workflows}` and yoki-switch's `.<x>-merged`
 * staging directories are not touched (milestone 4).
 *
 * The dependency direction is the one
 * `rules/decisions/2026-09-22-config-layout-no-personal-layer.md` fixes:
 * sources → output, one way. The destination is read for two reasons and no
 * others — to carry unmanaged keys through, and to say what is leaving. That
 * is a property of `domain/claude/settings.ts`, which is why this module hands
 * it the parsed file and takes back both the result and the report, rather
 * than consulting the file itself. The link destinations are inspected for
 * the same second reason only: to say what `--write` would do to what is
 * there.
 *
 * Hand-edit detection for both generated files reuses `domain/tiers/plan.ts`
 * and the same manifest the tier targets use: a file that matches neither
 * jig's last write nor the newly generated text is a conflict, not something
 * to overwrite. One conflict anywhere — either file, or a `commands`
 * directory holding real files — stops the whole write: the parts are one
 * delivery, and a half-applied one is harder to reason about than none.
 */

import {
  AGENTS_MD_BYTE_LIMIT,
  type RuleSource,
  type SkippedDecision,
  agentsMdBytes,
  decisionLines,
  isCommonRule,
  renderAgentsMd,
} from "../../domain/claude/agents-md";
import { type CommandsAction, classifyCommands } from "../../domain/claude/commands";
import { type ClaudeHookPaths, buildClaudeHooks } from "../../domain/claude/hooks";
import {
  type LinkPlan,
  type PathState,
  backupPath,
  planDirectory,
  planLink,
} from "../../domain/claude/links";
import { DEFAULT_PERMITS } from "../../domain/claude/permits";
import {
  type RuleDirSelection,
  type RulesDirEntry,
  type RulesEntryAction,
  reconcileRulesDir,
  selectRuleDirs,
} from "../../domain/claude/rules-dir";
import {
  NO_SANDBOX_SOURCE,
  type SandboxSource,
  hostSandbox,
  parseSandboxSource,
} from "../../domain/claude/sandbox";
import {
  type ClaudeComposition,
  composeClaudeSettings,
  renderClaudeSettings,
} from "../../domain/claude/settings";
import type { JsonObject } from "../../domain/compose/merge";
import { applyTemplate } from "../../domain/compose/template";
import { parseMcpLayer } from "../../domain/mcp/parse";
import { buildClaudeMcpServers } from "../../domain/mcp/to-claude";
import { parsePolicy } from "../../domain/policy/parse";
import {
  type ClaudePermissions,
  toClaudePermissions,
} from "../../domain/policy/to-claude-permissions";
import { unifiedDiff } from "../../domain/tiers/diff";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import type { ClaudeApplyPorts } from "./ports";

export interface ClaudeApplyPaths {
  /** `llm/harness/`, absolute. `skills/`, `agents/`, `rules/` and `rules/common/` are under it. */
  readonly harnessRoot: string;
  /** `llm/harness/policy/guard-rules.json`. */
  readonly guardRules: string;
  /** `llm/harness/mcp/servers.json`. */
  readonly mcpServers: string;
  /** `llm/harness/policy/sandbox.json`. Absent is tolerated, and reported. */
  readonly sandbox: string;
  /** `llm/harness/rules/decisions/`. */
  readonly decisions: string;
  /** Destination: `~/.claude/settings.json`. */
  readonly settings: string;
  /** Destination: `~/.claude/AGENTS.md`, generated. */
  readonly agentsMd: string;
  /** Destination: `~/.claude/CLAUDE.md`, a symlink with the relative target `AGENTS.md`. */
  readonly claudeMd: string;
  /** Destination: `~/.claude/skills`, a symlink to `<harnessRoot>/skills`. */
  readonly skills: string;
  /** Destination: `~/.claude/agents`, a symlink to `<harnessRoot>/agents`. */
  readonly agents: string;
  /** Destination: `~/.claude/rules`, a real directory of links to `<harnessRoot>/rules/<lang>`. */
  readonly rulesDir: string;
  /** Destination: `~/.claude/commands`, retired. */
  readonly commands: string;
  /** Substituted into mcp command paths; `{{HOME}}`. */
  readonly home: string;
}

export type ClaudeOutcome = "write" | "noop" | "conflict";

export interface AgentsMdReport {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  /** Past `AGENTS_MD_BYTE_LIMIT`: Codex truncates there. A reported line, not an error. */
  readonly overLimit: boolean;
  readonly outcome: PlanAction;
  /** `rules/common/*.md` rendered in, in order. */
  readonly commonFiles: readonly string[];
  /** Decision notes the renderer skipped, with why. */
  readonly skipped: readonly SkippedDecision[];
  /**
   * Set when a file jig never wrote stands at the path: on `--write` it is
   * renamed to this before the first generated file lands, so the hand-written
   * AGENTS.md of the yoki-switch days is kept, not overwritten.
   */
  readonly backupPath?: string;
}

export interface LinkReport extends LinkPlan {
  /** For `backup-then-create`: where the existing file or directory goes. */
  readonly backupPath?: string;
}

/** `RulesEntryAction` with the backup name filled in for a planned link. */
export type RulesEntryReport =
  | Exclude<RulesEntryAction, { readonly kind: "link" }>
  | { readonly kind: "link"; readonly name: string; readonly plan: LinkReport };

export interface RulesDirReport {
  readonly path: string;
  /** The directory itself. */
  readonly plan: LinkReport;
  readonly selection: RuleDirSelection;
  /** Per entry, planned links first. Empty when the directory is not a real directory yet. */
  readonly entries: readonly RulesEntryReport[];
}

export interface CommandsReport {
  readonly path: string;
  readonly action: CommandsAction;
}

export interface ClaudeApplyReport {
  /** Over all parts: any conflict wins; then any change; then noop. */
  readonly outcome: ClaudeOutcome;
  /** `settings.json` alone — the milestone-1 question, kept answerable on its own. */
  readonly settingsOutcome: PlanAction;
  readonly diff: string;
  /** True when `--write` applied the delivery. Never true with a conflict anywhere. */
  readonly wrote: boolean;
  readonly composition: ClaudeComposition;
  /** Rules the guard enforces that no native permission can express. */
  readonly hookOnly: ClaudePermissions["hookOnly"];
  /** The five hook command lines, for the dry-run listing. */
  readonly hookCommands: readonly { readonly event: string; readonly command: string }[];
  readonly agentsMd: AgentsMdReport;
  /** `CLAUDE.md`, `skills`, `agents` — in that order. */
  readonly links: readonly LinkReport[];
  readonly rulesDir: RulesDirReport;
  readonly commands: CommandsReport;
  /** `undefined` when `policy/sandbox.json` does not exist yet. */
  readonly sandboxSourcePath: string | undefined;
  readonly message?: string;
}

async function readJson(
  ports: ClaudeApplyPorts,
  path: string,
): Promise<{ readonly text: string; readonly json: unknown } | undefined> {
  const text = await ports.readFile(path);
  if (text === undefined) return undefined;
  return { text, json: JSON.parse(text) as unknown };
}

/**
 * The allow list: the guard policy's own `permit` rules, plus the three
 * defaults the decision requires be present from the start. A default that is
 * also a real permit rule collapses to one entry.
 */
function allowList(projected: ClaudePermissions): readonly string[] {
  return [...new Set([...projected.allow, ...DEFAULT_PERMITS.map((permit) => permit.rule)])].sort();
}

async function buildMcpServers(
  ports: ClaudeApplyPorts,
  paths: ClaudeApplyPaths,
): Promise<JsonObject> {
  const read = await readJson(ports, paths.mcpServers);
  if (read === undefined) {
    throw new Error(`jig apply --target claude: MCP source not found at ${paths.mcpServers}`);
  }
  const layer = parseMcpLayer(read.text, paths.mcpServers);
  const servers = buildClaudeMcpServers(layer.servers);
  return applyTemplate(servers, { HOME: paths.home }) as JsonObject;
}

/**
 * `policy/sandbox.json`, or the empty default when it does not exist yet.
 *
 * Tolerating absence is deliberate and one-directional: an empty
 * `excludedCommands` is the *tightest* answer, so a missing source can only
 * over-restrict. The apply reports which of the two it used, because an empty
 * list that nobody chose and an empty list somebody chose are different facts.
 */
async function readSandboxSource(
  ports: ClaudeApplyPorts,
  path: string,
): Promise<{ readonly source: SandboxSource; readonly found: boolean }> {
  const read = await readJson(ports, path);
  if (read === undefined) return { source: NO_SANDBOX_SOURCE, found: false };
  return { source: parseSandboxSource(read.json, path), found: true };
}

/** Every `*.md` in a directory, in name order, with its text. Files that vanish between list and read are skipped. */
async function readMarkdownDir(
  ports: ClaudeApplyPorts,
  dir: string,
  keep: (name: string) => boolean,
): Promise<readonly RuleSource[]> {
  const names = [...(await ports.listDir(dir))].filter(keep);
  names.sort();
  const sources: RuleSource[] = [];
  for (const file of names) {
    const text = await ports.readFile(`${dir}/${file}`);
    if (text !== undefined) sources.push({ file, text });
  }
  return sources;
}

async function buildAgentsMd(
  ports: ClaudeApplyPorts,
  paths: ClaudeApplyPaths,
): Promise<{
  readonly content: string;
  readonly commonFiles: readonly string[];
  readonly skipped: readonly SkippedDecision[];
}> {
  const common = await readMarkdownDir(ports, `${paths.harnessRoot}/rules/common`, isCommonRule);
  const notes = await readMarkdownDir(ports, paths.decisions, (name) => name.endsWith(".md"));
  const decisions = decisionLines(notes);
  return {
    content: renderAgentsMd({ harnessRoot: paths.harnessRoot, common, decisions }),
    commonFiles: common.map((source) => source.file),
    skipped: decisions.skipped,
  };
}

/** Subdirectories of `<harnessRoot>/rules/`, by `lstat` — a README there is a file and never a candidate. */
async function listRuleDirs(ports: ClaudeApplyPorts, harnessRules: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const name of await ports.listDir(harnessRules)) {
    const state = await ports.inspect(`${harnessRules}/${name}`);
    if (state.kind === "dir") dirs.push(name);
  }
  return dirs;
}

/** The entries of a directory with what each is; `[]` for anything that is not a real directory. */
async function inspectEntries(
  ports: ClaudeApplyPorts,
  dir: string,
  state: PathState,
): Promise<readonly RulesDirEntry[]> {
  if (state.kind !== "dir") return [];
  const entries: RulesDirEntry[] = [];
  for (const name of await ports.listDir(dir)) {
    entries.push({ name, state: await ports.inspect(`${dir}/${name}`) });
  }
  return entries;
}

function withBackup(plan: LinkPlan, now: Date): LinkReport {
  return plan.state === "backup-then-create"
    ? { ...plan, backupPath: backupPath(plan.path, now) }
    : plan;
}

async function planLinks(
  ports: ClaudeApplyPorts,
  paths: ClaudeApplyPaths,
  now: Date,
): Promise<readonly LinkReport[]> {
  // CLAUDE.md's target is relative on purpose: the two files sit side by side
  // and a moved `~/.claude` keeps the pair intact.
  const wanted: readonly { readonly path: string; readonly target: string }[] = [
    { path: paths.claudeMd, target: "AGENTS.md" },
    { path: paths.skills, target: `${paths.harnessRoot}/skills` },
    { path: paths.agents, target: `${paths.harnessRoot}/agents` },
  ];
  const links: LinkReport[] = [];
  for (const { path, target } of wanted) {
    links.push(withBackup(planLink(path, target, await ports.inspect(path)), now));
  }
  return links;
}

async function planRulesDir(
  ports: ClaudeApplyPorts,
  paths: ClaudeApplyPaths,
  now: Date,
): Promise<RulesDirReport> {
  const harnessRules = `${paths.harnessRoot}/rules`;
  const selection = selectRuleDirs(await listRuleDirs(ports, harnessRules));
  const state = await ports.inspect(paths.rulesDir);
  const entries: RulesEntryReport[] = reconcileRulesDir({
    rulesDir: paths.rulesDir,
    harnessRules,
    planned: selection.linked,
    entries: await inspectEntries(ports, paths.rulesDir, state),
  }).map((action) =>
    action.kind === "link" ? { ...action, plan: withBackup(action.plan, now) } : action,
  );
  return {
    path: paths.rulesDir,
    plan: withBackup(planDirectory(paths.rulesDir, state), now),
    selection,
    entries,
  };
}

async function planCommands(ports: ClaudeApplyPorts, path: string): Promise<CommandsReport> {
  const state = await ports.inspect(path);
  return { path, action: classifyCommands(state, await inspectEntries(ports, path, state)) };
}

/** Execute one link plan. `ok` is a no-op; the others end with the link in place. */
async function applyLink(ports: ClaudeApplyPorts, link: LinkReport): Promise<void> {
  switch (link.state) {
    case "ok":
      return;
    case "replace":
      await ports.remove(link.path);
      break;
    case "backup-then-create":
      if (link.backupPath !== undefined) await ports.rename(link.path, link.backupPath);
      break;
    case "create":
      break;
  }
  await ports.symlink(link.target, link.path);
}

async function applyRulesDir(ports: ClaudeApplyPorts, report: RulesDirReport): Promise<void> {
  const dir = report.plan;
  if (dir.state === "replace") await ports.remove(dir.path);
  if (dir.state === "backup-then-create" && dir.backupPath !== undefined) {
    await ports.rename(dir.path, dir.backupPath);
  }
  if (dir.state !== "ok") await ports.mkdir(dir.path);
  for (const entry of report.entries) {
    if (entry.kind === "link") await applyLink(ports, entry.plan);
    else if (entry.kind === "stale") await ports.remove(entry.path);
  }
}

function needsWrite(report: Omit<ClaudeApplyReport, "outcome" | "wrote" | "message">): boolean {
  const linkChanges = report.links.some((link) => link.state !== "ok");
  const ruleChanges =
    report.rulesDir.plan.state !== "ok" ||
    report.rulesDir.entries.some(
      (entry) => entry.kind === "stale" || (entry.kind === "link" && entry.plan.state !== "ok"),
    );
  return (
    report.settingsOutcome === "write" ||
    report.agentsMd.outcome === "write" ||
    linkChanges ||
    ruleChanges ||
    report.commands.action.kind === "remove"
  );
}

export async function applyClaude(
  input: {
    readonly paths: ClaudeApplyPaths;
    readonly hookPaths: ClaudeHookPaths;
    readonly write: boolean;
  },
  ports: ClaudeApplyPorts,
): Promise<ClaudeApplyReport> {
  const { paths } = input;
  const policySource = await readJson(ports, paths.guardRules);
  if (policySource === undefined) {
    throw new Error(`jig apply --target claude: guard policy not found at ${paths.guardRules}`);
  }
  const projected = toClaudePermissions(parsePolicy(policySource.json as Record<string, unknown>));

  const sandbox = await readSandboxSource(ports, paths.sandbox);

  const hooks = buildClaudeHooks(input.hookPaths);
  const composition = composeClaudeSettings(
    (await readJson(ports, paths.settings))?.json as JsonObject | undefined,
    {
      hooks,
      allow: allowList(projected),
      deny: projected.deny,
      // Per rules/decisions/2026-09-22-allow-from-guard-permit.md: the narrow
      // allow list above is what survives auto mode's first stage; the mode
      // itself stays auto so everything unlisted still reaches the classifier.
      defaultMode: "auto",
      sandbox: hostSandbox(sandbox.source),
      mcpServers: await buildMcpServers(ports, paths),
    },
  );

  const currentText = (await ports.readFile(paths.settings)) ?? "";
  const generated = renderClaudeSettings(composition.settings);
  const diff = unifiedDiff(paths.settings, currentText, "generated", generated);

  const manifest = { ...(await ports.readManifest()) };
  const settingsPlan = planApply({
    currentContent: currentText === "" ? undefined : currentText,
    generatedContent: generated,
    manifestHash: manifest[paths.settings],
    sha256: ports.sha256,
  });

  const now = ports.now();
  const agents = await buildAgentsMd(ports, paths);
  const agentsCurrent = await ports.readFile(paths.agentsMd);
  const agentsPlan = planApply({
    currentContent: agentsCurrent,
    generatedContent: agents.content,
    manifestHash: manifest[paths.agentsMd],
    sha256: ports.sha256,
  });
  const agentsMd: AgentsMdReport = {
    path: paths.agentsMd,
    content: agents.content,
    bytes: agentsMdBytes(agents.content),
    overLimit: agentsMdBytes(agents.content) > AGENTS_MD_BYTE_LIMIT,
    outcome: agentsPlan.action,
    commonFiles: agents.commonFiles,
    skipped: agents.skipped,
    // A file jig has no record of writing is somebody's, until proven otherwise.
    ...(agentsPlan.action === "write" &&
    agentsCurrent !== undefined &&
    manifest[paths.agentsMd] === undefined
      ? { backupPath: backupPath(paths.agentsMd, now) }
      : {}),
  };

  const hookCommands = Object.entries(hooks).map(([event, value]) => ({
    event,
    command: firstCommand(value),
  }));

  const base = {
    settingsOutcome: settingsPlan.action,
    diff,
    composition,
    hookOnly: projected.hookOnly,
    hookCommands,
    agentsMd,
    links: await planLinks(ports, paths, now),
    rulesDir: await planRulesDir(ports, paths, now),
    commands: await planCommands(ports, paths.commands),
    sandboxSourcePath: sandbox.found ? paths.sandbox : undefined,
  };

  const conflicts: string[] = [
    ...(settingsPlan.action === "conflict"
      ? ["settings.json differs from both jig's last write and the newly generated content"]
      : []),
    ...(agentsPlan.action === "conflict"
      ? ["AGENTS.md differs from both jig's last write and the newly generated content"]
      : []),
    ...(base.commands.action.kind === "conflict"
      ? [`${paths.commands} is ${base.commands.action.reason}`]
      : []),
  ];
  if (conflicts.length > 0) {
    return {
      ...base,
      outcome: "conflict",
      wrote: false,
      message: `hand-edit conflict: ${conflicts.join("; ")} — reconcile before --write`,
    };
  }

  const changes = needsWrite(base);
  if (input.write && changes) {
    if (settingsPlan.action === "write") {
      await ports.writeAtomic(paths.settings, generated);
      manifest[paths.settings] = ports.sha256(generated);
    }
    if (agentsPlan.action === "write") {
      if (agentsMd.backupPath !== undefined)
        await ports.rename(paths.agentsMd, agentsMd.backupPath);
      await ports.writeAtomic(paths.agentsMd, agents.content);
      manifest[paths.agentsMd] = ports.sha256(agents.content);
    }
    // The manifest seeds for the two files even when they were already
    // current, so a LATER hand edit is detected as one.
    manifest[paths.settings] ??= ports.sha256(generated);
    manifest[paths.agentsMd] ??= ports.sha256(agents.content);
    await ports.writeManifest(manifest);
    await ports.writeProvenance(dirOf(paths.settings), {
      sourceFile: paths.guardRules,
      sourceSha256: ports.sha256(policySource.text),
      generatedAt: now.toISOString(),
      jigVersion: ports.jigVersion,
    });
    for (const link of base.links) await applyLink(ports, link);
    await applyRulesDir(ports, base.rulesDir);
    if (base.commands.action.kind === "remove") await ports.remove(paths.commands);
    return { ...base, outcome: "write", wrote: true };
  }

  if (input.write && !changes) {
    // Nothing to deliver, but seed the manifest for both generated files so a
    // LATER hand edit is detected as one. No file content changes: this is
    // out-of-repo state only.
    if (manifest[paths.settings] === undefined || manifest[paths.agentsMd] === undefined) {
      manifest[paths.settings] ??= ports.sha256(generated);
      manifest[paths.agentsMd] ??= ports.sha256(agents.content);
      await ports.writeManifest(manifest);
    }
  }

  return { ...base, outcome: changes ? "write" : "noop", wrote: false };
}

/** The one command line inside an event's single group, for the dry-run listing. */
function firstCommand(eventValue: unknown): string {
  const group = Array.isArray(eventValue) ? eventValue[0] : undefined;
  const hooks = (group as { hooks?: unknown } | undefined)?.hooks;
  const hook = Array.isArray(hooks) ? hooks[0] : undefined;
  const command = (hook as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? command : "(none)";
}

function dirOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}
