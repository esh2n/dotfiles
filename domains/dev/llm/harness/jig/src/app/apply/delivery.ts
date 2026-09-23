/**
 * What the Claude Code and Codex targets deliver the same way: a generated
 * `AGENTS.md` with hand-edit detection and a first-write backup, single
 * symlinks, and managed directories of links reconciled against a selection
 * (`domain/claude/managed-dir.ts`). Both use-cases (`./apply-claude.ts`,
 * `./apply-codex.ts`) plan with these and execute with these, so a rule such
 * as "user content is never deleted" is one function, not two.
 *
 * Nothing here decides anything about a destination: every mutating verb is
 * called on a path the domain has already classified, and the destination is
 * read only to say what `--write` would do to what is there.
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
import {
  type LinkPlan,
  type PathState,
  backupPath,
  planDirectory,
  planLink,
} from "../../domain/claude/links";
import {
  type ManagedDirEntry,
  type ManagedEntryAction,
  type ManagedSelection,
  reconcileManagedDir,
} from "../../domain/claude/managed-dir";
import { type SkillCandidate, selectSkillDirs } from "../../domain/claude/skills-dir";
import { unifiedDiff } from "../../domain/tiers/diff";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import type { ClaudeApplyPorts } from "./ports";

export interface AgentsMdReport {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  /** Past `AGENTS_MD_BYTE_LIMIT`: Codex truncates there. A reported line, not an error. */
  readonly overLimit: boolean;
  readonly outcome: PlanAction;
  /** Current file vs generated; empty when they already agree. */
  readonly diff: string;
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

/** `ManagedEntryAction` with the backup name filled in for a planned link. */
export type ManagedEntryReport =
  | Exclude<ManagedEntryAction, { readonly kind: "link" }>
  | { readonly kind: "link"; readonly name: string; readonly plan: LinkReport };

/** One managed directory of links. */
export interface ManagedDirReport {
  readonly path: string;
  /** The directory itself. */
  readonly plan: LinkReport;
  readonly selection: ManagedSelection;
  /** Per entry, planned links first. Empty when the directory is not a real directory yet. */
  readonly entries: readonly ManagedEntryReport[];
}

export async function readJson(
  ports: ClaudeApplyPorts,
  path: string,
): Promise<{ readonly text: string; readonly json: unknown } | undefined> {
  const text = await ports.readFile(path);
  if (text === undefined) return undefined;
  return { text, json: JSON.parse(text) as unknown };
}

/** Every `*.md` in a directory, in name order, with its text. Files that vanish between list and read are skipped. */
export async function readMarkdownDir(
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

/** The generated AGENTS.md: one source (`rules/`), rendered once, whichever harness's directory it lands in. */
export async function buildAgentsMd(
  ports: ClaudeApplyPorts,
  paths: { readonly harnessRoot: string; readonly decisions: string },
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

/**
 * The plan for one AGENTS.md destination: hand-edit detection through the
 * manifest, and a backup name when a file jig has no record of writing
 * stands there — somebody's, until proven otherwise.
 */
export async function planAgentsMd(
  ports: ClaudeApplyPorts,
  input: {
    readonly path: string;
    readonly generated: Awaited<ReturnType<typeof buildAgentsMd>>;
    readonly manifest: Readonly<Record<string, string>>;
    readonly now: Date;
  },
): Promise<AgentsMdReport> {
  const current = await ports.readFile(input.path);
  const plan = planApply({
    currentContent: current,
    generatedContent: input.generated.content,
    manifestHash: input.manifest[input.path],
    sha256: ports.sha256,
  });
  const bytes = agentsMdBytes(input.generated.content);
  return {
    path: input.path,
    content: input.generated.content,
    bytes,
    overLimit: bytes > AGENTS_MD_BYTE_LIMIT,
    outcome: plan.action,
    diff: unifiedDiff(input.path, current ?? "", "generated", input.generated.content),
    commonFiles: input.generated.commonFiles,
    skipped: input.generated.skipped,
    ...(plan.action === "write" && current !== undefined && input.manifest[input.path] === undefined
      ? { backupPath: backupPath(input.path, input.now) }
      : {}),
  };
}

/** Execute an AGENTS.md plan that came out as `write`, and record the hash. */
export async function applyAgentsMd(
  ports: ClaudeApplyPorts,
  report: AgentsMdReport,
  manifest: Record<string, string>,
): Promise<void> {
  if (report.backupPath !== undefined) await ports.rename(report.path, report.backupPath);
  await ports.writeAtomic(report.path, report.content);
  manifest[report.path] = ports.sha256(report.content);
}

/** The entries of a directory with what each is, by `lstat`. */
export async function listEntries(
  ports: ClaudeApplyPorts,
  dir: string,
): Promise<readonly ManagedDirEntry[]> {
  const entries: ManagedDirEntry[] = [];
  for (const name of await ports.listDir(dir)) {
    entries.push({ name, state: await ports.inspect(`${dir}/${name}`) });
  }
  return entries;
}

/** The entries of a destination directory; `[]` for anything that is not a real directory (yet). */
export async function inspectEntries(
  ports: ClaudeApplyPorts,
  dir: string,
  state: PathState,
): Promise<readonly ManagedDirEntry[]> {
  return state.kind === "dir" ? listEntries(ports, dir) : [];
}

/**
 * The entries with each symlink followed one hop, so a link that leads
 * nowhere can be told from one that leads elsewhere. A relative target is
 * resolved against the directory, as the kernel would.
 */
export async function probeDangling(
  ports: ClaudeApplyPorts,
  dir: string,
  entries: readonly ManagedDirEntry[],
): Promise<readonly ManagedDirEntry[]> {
  const probed: ManagedDirEntry[] = [];
  for (const entry of entries) {
    if (entry.state.kind !== "symlink") {
      probed.push(entry);
      continue;
    }
    const target = entry.state.target.startsWith("/")
      ? entry.state.target
      : `${dir}/${entry.state.target}`;
    const found = await ports.inspect(target);
    probed.push({ ...entry, dangling: found.kind === "missing" });
  }
  return probed;
}

/**
 * Every entry of `<harnessRoot>/skills/`, with whether it holds a `SKILL.md`.
 * Only a directory (or a link, which may lead to one) is probed; nothing lies
 * under a regular file such as the tree's `README.md`.
 */
export async function listSkillCandidates(
  ports: ClaudeApplyPorts,
  harnessSkills: string,
): Promise<readonly SkillCandidate[]> {
  const candidates: SkillCandidate[] = [];
  for (const entry of await listEntries(ports, harnessSkills)) {
    const mayHoldSkill = entry.state.kind === "dir" || entry.state.kind === "symlink";
    const skillMd = mayHoldSkill
      ? await ports.inspect(`${harnessSkills}/${entry.name}/SKILL.md`)
      : { kind: "missing" as const };
    candidates.push({ ...entry, hasSkillMd: skillMd.kind === "file" });
  }
  return candidates;
}

/** The targets that deliver `~/.agents/skills`; each finds the others' links `ok`. */
export const AGENTS_SKILLS_MOUNT_TARGETS = ["codex", "omp", "pi"] as const;

export type AgentsSkillsMountTarget = (typeof AGENTS_SKILLS_MOUNT_TARGETS)[number];

export interface AgentsSkillsMountPaths {
  /** `llm/harness/`, absolute. */
  readonly harnessRoot: string;
  /** Destination: `~/.agents/skills`. */
  readonly agentsSkills: string;
  /** The trees yoki-switch linked skills from: a link under one of them is stale, not somebody's. */
  readonly formerSkillRoots: readonly string[];
}

/** A `ManagedDirReport` that also says which target planned it. */
export interface AgentsSkillsMountReport extends ManagedDirReport {
  readonly target: AgentsSkillsMountTarget;
}

/**
 * `~/.agents/skills/`: the cross-harness skills mount, one link per skill
 * directory of `skills/`. Codex reads it as the user scope of its skill
 * discovery (https://learn.chatgpt.com/docs/build-skills, `$HOME/.agents/skills`),
 * and so do pi and omp (pi: https://pi.dev/docs/latest/skills, "Pi also
 * supports the Agent Skills locations `~/.agents/skills/` and
 * `.agents/skills/`"; omp: the `agents` provider, "Load skills from
 * .agent/skills and .agents/skills (project walk-up + user home)",
 * `packages/coding-agent/src/discovery/agents.ts`). One directory, one plan,
 * whichever target asks: the same links are planned from the same sources,
 * so the second target to run finds every entry `ok`. The report carries
 * which target planned it, and the dry-run says so.
 *
 * Today the directory holds yoki-switch's links into the retired
 * `claude-profiles/` tree, dangling since the sources moved; those are stale
 * and go (`formerSourceDirs`, `probeDangling`), anything else is not jig's.
 */
export async function planAgentsSkillsMount(
  ports: ClaudeApplyPorts,
  paths: AgentsSkillsMountPaths,
  target: AgentsSkillsMountTarget,
  now: Date,
): Promise<AgentsSkillsMountReport> {
  const sourceDir = `${paths.harnessRoot}/skills`;
  const selection = selectSkillDirs(await listSkillCandidates(ports, sourceDir));
  const report = await planManagedDir(ports, {
    dir: paths.agentsSkills,
    sourceDir,
    selection,
    now,
    formerSourceDirs: paths.formerSkillRoots,
    probeDangling: true,
  });
  return { ...report, target };
}

export function withBackup(plan: LinkPlan, now: Date): LinkReport {
  return plan.state === "backup-then-create"
    ? { ...plan, backupPath: backupPath(plan.path, now) }
    : plan;
}

export interface ManagedDirInput {
  readonly dir: string;
  readonly sourceDir: string;
  readonly selection: ManagedSelection;
  readonly now: Date;
  /** See `ReconcileManagedDirInput.targetOf`. */
  readonly targetOf?: (name: string) => string;
  /** See `ReconcileManagedDirInput.formerSourceDirs`. */
  readonly formerSourceDirs?: readonly string[];
  /** Follow each existing link one hop, so a dangling one is stale rather than foreign. */
  readonly probeDangling?: boolean;
}

/**
 * One managed directory: the directory itself, then its entries reconciled
 * against the selection. Entries that are neither planned nor stale are
 * reported as foreign and never touched — for `~/.claude/skills/` that is
 * Claude Code's own `synced/` tree and its `.bucket-<id>` marker.
 */
export async function planManagedDir(
  ports: ClaudeApplyPorts,
  input: ManagedDirInput,
): Promise<ManagedDirReport> {
  const state = await ports.inspect(input.dir);
  const found = await inspectEntries(ports, input.dir, state);
  const entries: ManagedEntryReport[] = reconcileManagedDir({
    dir: input.dir,
    sourceDir: input.sourceDir,
    planned: input.selection.linked,
    ...(input.targetOf === undefined ? {} : { targetOf: input.targetOf }),
    ...(input.formerSourceDirs === undefined ? {} : { formerSourceDirs: input.formerSourceDirs }),
    entries: input.probeDangling === true ? await probeDangling(ports, input.dir, found) : found,
  }).map((action) =>
    action.kind === "link" ? { ...action, plan: withBackup(action.plan, input.now) } : action,
  );
  return {
    path: input.dir,
    plan: withBackup(planDirectory(input.dir, state), input.now),
    selection: input.selection,
    entries,
  };
}

/** Execute one link plan. `ok` is a no-op; the others end with the link in place. */
export async function applyLink(ports: ClaudeApplyPorts, link: LinkReport): Promise<void> {
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

/** Execute one managed directory's plan: the directory first, then each entry. Foreign entries are not touched. */
export async function applyManagedDir(
  ports: ClaudeApplyPorts,
  report: ManagedDirReport,
): Promise<void> {
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

/** True when `--write` would touch the directory or any entry in it. */
export function managedDirChanges(report: ManagedDirReport): boolean {
  return (
    report.plan.state !== "ok" ||
    report.entries.some(
      (entry) => entry.kind === "stale" || (entry.kind === "link" && entry.plan.state !== "ok"),
    )
  );
}

/** A single symlink destination, planned from what stands there. */
export async function planSingleLink(
  ports: ClaudeApplyPorts,
  path: string,
  target: string,
  now: Date,
): Promise<LinkReport> {
  return withBackup(planLink(path, target, await ports.inspect(path)), now);
}

export function dirOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}
