/**
 * `~/.claude/agents/`: one generated file per house or pack agent
 * (rules/decisions/2026-10-19-model-assignment.md). The sources name a
 * house tier (`main`, `complex`, `executor`) that Claude Code does not know,
 * so the directory stops being a directory of links: each file is the source
 * with `model:` replaced by the alias the `claude` table of
 * `agents/models.json` maps it to (`../../domain/claude/claude-agent.ts`).
 *
 * The links jig kept here before are its own and are replaced in place, no
 * backup. A file jig wrote whose source is gone is stale and goes; one edited
 * since stays, named (`./generated-agents.ts`). A house agent outside the
 * tier and effort vocabulary stops the apply; a pack agent that does not
 * parse is excluded with its reason.
 */

import {
  type ModelChoice,
  checkAgentVocabulary,
  modelChoiceFor,
  parseAgentDefinition,
} from "../../domain/claude/agent-definition";
import { parseAgentModels } from "../../domain/claude/agent-models";
import { isClaudeModelName, renderClaudeAgent } from "../../domain/claude/claude-agent";
import { type PathState, backupPath } from "../../domain/claude/links";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import { listEntries } from "./delivery";
import {
  type StaleAgentFile,
  fromPack,
  reasonOf,
  removeStale,
  sortLeftovers,
} from "./generated-agents";
import { type Plugins, agentPlan } from "./plugins";
import type { ClaudeApplyPorts } from "./ports";

export interface ClaudeAgentFileReport {
  readonly name: string;
  readonly path: string;
  readonly sourceFile: string;
  readonly content: string;
  readonly outcome: PlanAction;
  readonly model: ModelChoice;
  /** Set when a file jig never wrote stands at the path: renamed to this before the generated one lands. */
  readonly backupPath?: string;
  /** Set when jig's own link stands at the path: removed before the file lands. */
  readonly replacesLink?: string;
  /** Set when a link jig did not make stands at the path: a conflict, left alone. */
  readonly foreignLink?: string;
}

export interface StaleAgentLink {
  readonly name: string;
  readonly path: string;
  readonly target: string;
  /** Why it goes: its source is gone, or the source is now excluded from generation. */
  readonly why: "source gone" | "source excluded";
}

export interface ClaudeAgentsReport {
  readonly path: string;
  /** What stands at the directory itself; a symlink is replaced by a real directory. */
  readonly dirState: PathState;
  readonly files: readonly ClaudeAgentFileReport[];
  /** Source entries that produce no file, with why. */
  readonly excluded: readonly { readonly name: string; readonly reason: string }[];
  /** Files jig wrote whose source is gone, unchanged since: removed on `--write`. */
  readonly stale: readonly StaleAgentFile[];
  /** jig's links whose source is gone, or that a file now replaces: removed on `--write`. */
  readonly staleLinks: readonly StaleAgentLink[];
  /** Entries no source produces that are not jig's. Left alone. */
  readonly foreign: readonly { readonly name: string; readonly what: string }[];
  /** Tiers the `claude` table has no alias for, and how many agents name each. */
  readonly unmappedTiers: readonly { readonly tier: string; readonly count: number }[];
}

export interface ClaudeAgentsInput {
  readonly dir: string;
  readonly harnessRoot: string;
  readonly plugins: Plugins;
  readonly manifest: Readonly<Record<string, string>>;
  readonly now: Date;
}

/** A link into the harness tree or a pack checkout is one jig made. A relative target is read from the directory holding the link. */
function jigLink(target: string, input: ClaudeAgentsInput): boolean {
  if (!target.startsWith("/")) return jigLink(resolveFrom(input.dir, target), input);
  const roots = [
    input.harnessRoot,
    ...(input.plugins.dir === undefined ? [] : [input.plugins.dir]),
  ];
  return roots.some((root) => target === root || target.startsWith(`${root}/`));
}

function resolveFrom(dir: string, target: string): string {
  const parts = dir.split("/");
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

async function readClaudeModels(ports: ClaudeApplyPorts, harnessRoot: string) {
  const path = `${harnessRoot}/agents/models.json`;
  const text = await ports.readFile(path);
  return text === undefined ? {} : parseAgentModels(text, path).claude;
}

export async function planClaudeAgents(
  ports: ClaudeApplyPorts,
  input: ClaudeAgentsInput,
): Promise<ClaudeAgentsReport> {
  const sourceDir = `${input.harnessRoot}/agents`;
  const { selection, targetOf } = await agentPlan(ports, sourceDir, input.plugins);
  const claudeModels = await readClaudeModels(ports, input.harnessRoot);
  const dirState = await ports.inspect(input.dir);
  const isDir = dirState.kind === "dir";

  const files: ClaudeAgentFileReport[] = [];
  const excluded = [...selection.excluded];
  const produced = new Set<string>();
  const unmapped = new Map<string, number>();
  for (const sourceFile of selection.linked) {
    const sourcePath = targetOf(sourceFile);
    const text = await ports.readFile(sourcePath);
    if (text === undefined) continue;
    let built: { model: ModelChoice; content: string };
    try {
      const definition = parseAgentDefinition(text, sourceFile.replace(/\.md$/, ""));
      const pack = fromPack(sourcePath, sourceDir);
      if (!pack) checkAgentVocabulary(definition);
      const native =
        pack && definition.model !== undefined && isClaudeModelName(definition.model)
          ? definition.model
          : undefined;
      const model: ModelChoice =
        native === undefined
          ? modelChoiceFor(definition.model, claudeModels, definition.models?.claude)
          : { kind: "mapped", tier: native, model: native };
      built = { model, content: renderClaudeAgent({ text, model, sourcePath }) };
    } catch (error) {
      if (!fromPack(sourcePath, sourceDir)) {
        throw new Error(`jig apply --target claude: agents/${sourceFile}: ${reasonOf(error)}`);
      }
      excluded.push({ name: sourceFile, reason: reasonOf(error) });
      continue;
    }
    const { model, content } = built;
    if (model.kind === "unmapped") unmapped.set(model.tier, (unmapped.get(model.tier) ?? 0) + 1);
    const name = sourceFile;
    const path = `${input.dir}/${name}`;
    produced.add(name);
    const state: PathState = isDir ? await ports.inspect(path) : { kind: "missing" };
    if (state.kind === "symlink") {
      files.push(
        jigLink(state.target, input)
          ? { name, path, sourceFile, content, outcome: "write", model, replacesLink: state.target }
          : {
              name,
              path,
              sourceFile,
              content,
              outcome: "conflict",
              model,
              foreignLink: state.target,
            },
      );
      continue;
    }
    const current = state.kind === "file" ? await ports.readFile(path) : undefined;
    const plan = planApply({
      currentContent: current,
      generatedContent: content,
      manifestHash: input.manifest[path],
      sha256: ports.sha256,
    });
    files.push({
      name,
      path,
      sourceFile,
      content,
      outcome: plan.action,
      model,
      // A file jig has no record of writing is somebody's, until proven otherwise.
      ...(plan.action === "write" && current !== undefined && input.manifest[path] === undefined
        ? { backupPath: backupPath(path, input.now) }
        : {}),
    });
  }

  const staleLinks: StaleAgentLink[] = [];
  const skip = new Set(produced);
  const excludedNames = new Set(excluded.map((entry) => entry.name));
  if (isDir) {
    for (const entry of await listEntries(ports, input.dir)) {
      if (produced.has(entry.name) || entry.state.kind !== "symlink") continue;
      if (!jigLink(entry.state.target, input)) continue;
      staleLinks.push({
        name: entry.name,
        path: `${input.dir}/${entry.name}`,
        target: entry.state.target,
        why: excludedNames.has(entry.name) ? "source excluded" : "source gone",
      });
      skip.add(entry.name);
    }
  }
  const { stale, foreign } = isDir
    ? await sortLeftovers(ports, input.dir, skip, input.manifest)
    : { stale: [], foreign: [] };

  return {
    path: input.dir,
    dirState,
    files,
    excluded,
    stale,
    staleLinks,
    foreign,
    unmappedTiers: [...unmapped.entries()]
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function claudeAgentsChanges(report: ClaudeAgentsReport): boolean {
  return (
    report.dirState.kind !== "dir" ||
    report.files.some((file) => file.outcome === "write") ||
    report.stale.length > 0 ||
    report.staleLinks.length > 0
  );
}

export function claudeAgentsConflicts(report: ClaudeAgentsReport): readonly string[] {
  const dir =
    report.dirState.kind === "file"
      ? [`${report.path} is a regular file where the agents directory goes`]
      : [];
  return [
    ...dir,
    ...report.files
      .filter((file) => file.outcome === "conflict")
      .map((file) =>
        file.foreignLink === undefined
          ? `${file.path} differs from both jig's last write and the newly generated agent`
          : `${file.path} is a link jig did not make (→ ${file.foreignLink})`,
      ),
  ];
}

/**
 * Record the files that already match what jig would write, so a later hand
 * edit is caught and a later removal of the source makes them stale. Returns
 * whether anything was added.
 */
export function seedClaudeAgents(
  report: ClaudeAgentsReport,
  manifest: Record<string, string>,
  sha256: (text: string) => string,
): boolean {
  let added = false;
  for (const file of report.files) {
    if (file.outcome !== "noop" || manifest[file.path] !== undefined) continue;
    manifest[file.path] = sha256(file.content);
    added = true;
  }
  return added;
}

export async function applyClaudeAgents(
  ports: ClaudeApplyPorts,
  report: ClaudeAgentsReport,
  manifest: Record<string, string>,
): Promise<void> {
  if (report.dirState.kind === "symlink") await ports.remove(report.path);
  if (report.dirState.kind !== "dir") await ports.mkdir(report.path);
  for (const link of report.staleLinks) await ports.remove(link.path);
  for (const file of report.files) {
    if (file.outcome !== "write") continue;
    if (file.replacesLink !== undefined) await ports.remove(file.path);
    if (file.backupPath !== undefined) await ports.rename(file.path, file.backupPath);
    await ports.writeAtomic(file.path, file.content);
    manifest[file.path] = ports.sha256(file.content);
  }
  await removeStale(ports, report.stale, manifest);
  seedClaudeAgents(report, manifest, ports.sha256);
}
