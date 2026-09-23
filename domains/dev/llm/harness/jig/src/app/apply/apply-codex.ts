/**
 * `jig apply --target codex` — deliver the Codex configuration from the
 * sources under `llm/harness/`, and either show what would change (default)
 * or do it (`--write`). Milestone 3a of the generator that retires
 * `yoki-switch`; the same shape as `./apply-claude.ts`, over
 * `$CODEX_HOME` (default `~/.codex`) and the cross-harness skills mount.
 *
 * - `~/.agents/skills/` — a managed directory of links, one per skill
 *   directory of `skills/`: the user scope of Codex's skill discovery
 *   (https://learn.chatgpt.com/docs/build-skills), and the directory pi and
 *   omp read too. Planned by `planAgentsSkillsMount` in `./delivery.ts`,
 *   which the omp target calls as well: one directory, one plan. Today it
 *   holds yoki-switch's links into the retired `claude-profiles/` tree,
 *   dangling since the sources moved; those are stale and go, anything
 *   else is not jig's.
 * - `~/.codex/skills/` — a managed directory of links, only for skills with
 *   a Codex port (`skills/<name>/codex/SKILL.md`), each link pointing at the
 *   port (`domain/codex/skills.ts`). yoki's command→skill conversions
 *   (`cmd-*`, real directories) are reported as leftovers and not removed:
 *   jig deletes links it or its predecessor made, never a directory.
 * - `~/.codex/AGENTS.md` — the same generated content as
 *   `~/.claude/AGENTS.md`, from the same renderer: one source, two
 *   destinations, no vocabulary substitution. yoki's file there is backed
 *   up before the first generated one lands, as the Claude target does.
 * - `~/.codex/agents/<name>.toml` — one generated file per `agents/*.md`
 *   (`domain/codex/agents.ts`), each tracked in the manifest so a hand edit
 *   is a conflict. A file there that no source produces is not jig's.
 * - `~/.codex/config.toml` — `[mcp_servers.<name>]` for every server with
 *   `targets.codex`, inside jig's `# jig:begin mcp` block
 *   (`domain/codex/config.ts`); every other table carried through. A
 *   server declared outside the block is a conflict, named, never
 *   duplicated.
 * - `~/.codex/hooks.json` — `jig codex register`'s; reported, not touched.
 *
 * The invariant is the Claude target's: sources → output, one way. The
 * destination is read to carry through what jig does not own and to say
 * what `--write` would do to what is there. Hand-edit detection is
 * `domain/tiers/plan.ts` and the shared manifest; for `config.toml` it
 * compares jig's block rather than the whole file, because Codex writes
 * `[projects.*]` into that file on its own. One conflict anywhere stops the
 * whole write.
 */

import { type AgentCandidate, selectAgentFiles } from "../../domain/claude/agents-dir";
import { backupPath } from "../../domain/claude/links";
import { describePathState } from "../../domain/claude/managed-dir";
import {
  type CodexModelChoice,
  codexAgentFileName,
  codexModelFor,
  parseAgentDefinition,
  renderCodexAgent,
} from "../../domain/codex/agents";
import {
  type ForeignMcpTable,
  buildCodexMcpTables,
  mcpServersDeclaredOutside,
  planMcpBlock,
  renderMcpBlock,
  yokiLeftovers,
} from "../../domain/codex/config";
import {
  type CodexSkillCandidate,
  codexPortTarget,
  selectCodexSkillPorts,
} from "../../domain/codex/skills";
import { parseMcpLayer } from "../../domain/mcp/parse";
import { unifiedDiff } from "../../domain/tiers/diff";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import {
  type AgentsMdReport,
  type AgentsSkillsMountReport,
  type ManagedDirReport,
  applyAgentsMd,
  applyManagedDir,
  buildAgentsMd,
  dirOf,
  listEntries,
  listSkillCandidates,
  managedDirChanges,
  planAgentsMd,
  planAgentsSkillsMount,
  planManagedDir,
  readJson,
} from "./delivery";
import type { CodexApplyPorts } from "./ports";

export interface CodexApplyPaths {
  /** `llm/harness/`, absolute. `skills/`, `agents/` and `rules/` are under it. */
  readonly harnessRoot: string;
  /** `llm/harness/mcp/servers.json`. */
  readonly mcpServers: string;
  /** `llm/harness/rules/decisions/`. */
  readonly decisions: string;
  /**
   * The trees yoki-switch linked skills from (`claude-profiles/{core,packs,personal}/skills`
   * and their parents): a link under one of them is stale, not somebody's.
   */
  readonly formerSkillRoots: readonly string[];
  /** Destination: `~/.agents/skills`, the cross-harness mount, one link per skill. */
  readonly agentsSkills: string;
  /** Destination: `~/.codex/skills`, one link per Codex port. */
  readonly codexSkills: string;
  /** Destination: `~/.codex/AGENTS.md`, generated. */
  readonly agentsMd: string;
  /** Destination: `~/.codex/agents/`, one generated `<name>.toml` per agent. */
  readonly agentsDir: string;
  /** Destination: `~/.codex/config.toml`; only jig's MCP block is written. */
  readonly configToml: string;
  /** `~/.codex/hooks.json`, reported only. */
  readonly hooksJson: string;
  /** Substituted into mcp command paths; `{{HOME}}`. */
  readonly home: string;
}

export type CodexOutcome = "write" | "noop" | "conflict";

/** One generated `~/.codex/agents/<name>.toml`. */
export interface AgentFileReport {
  readonly name: string;
  readonly path: string;
  readonly sourceFile: string;
  readonly content: string;
  readonly outcome: PlanAction;
  readonly model: CodexModelChoice;
  /** Set when a file jig never wrote stands at the path: renamed to this before the generated one lands. */
  readonly backupPath?: string;
}

export interface AgentsDirReport {
  readonly path: string;
  readonly files: readonly AgentFileReport[];
  /** Source entries that produce no file, with why. */
  readonly excluded: readonly { readonly name: string; readonly reason: string }[];
  /** Entries of the destination that no source produces: not jig's, left alone. */
  readonly foreign: readonly { readonly name: string; readonly what: string }[];
  /** Source tiers with no Codex model, and how many agents name each. */
  readonly unmappedTiers: readonly { readonly tier: string; readonly count: number }[];
}

export interface ConfigTomlReport {
  readonly path: string;
  readonly outcome: PlanAction;
  readonly diff: string;
  /** Servers the block carries, in source order. */
  readonly servers: readonly string[];
  readonly block: string;
  /** `[mcp_servers.<name>]` tables outside jig's block for servers jig writes: each a conflict. */
  readonly declaredOutside: readonly ForeignMcpTable[];
  /** What yoki left in the file, named for milestone 4. */
  readonly yokiLeftovers: readonly string[];
}

export interface CodexApplyReport {
  /** Over all parts: any conflict wins; then any change; then noop. */
  readonly outcome: CodexOutcome;
  /** True when `--write` applied the delivery. Never true with a conflict anywhere. */
  readonly wrote: boolean;
  /** `~/.agents/skills`, the mount the omp target delivers too (`delivery.ts`). */
  readonly agentsSkillsDir: AgentsSkillsMountReport;
  readonly codexSkillsDir: ManagedDirReport;
  readonly agentsMd: AgentsMdReport;
  readonly agents: AgentsDirReport;
  readonly configToml: ConfigTomlReport;
  /** Reported only: `jig codex register` owns it. */
  readonly hooksJson: string;
  readonly message?: string;
}

export interface CodexApplyOptions {
  /** Claude tier name (`haiku`/`sonnet`/`opus`) → Codex model id. Empty until a ruling supplies one. */
  readonly codexModels: Readonly<Record<string, string>>;
  /** Called with each generated TOML text before writing; throw to refuse. */
  readonly validateToml?: (text: string) => void;
}

/** Every entry of `skills/`, with whether it holds a `SKILL.md` and a `codex/SKILL.md`. */
async function listCodexSkillCandidates(
  ports: CodexApplyPorts,
  harnessSkills: string,
): Promise<readonly CodexSkillCandidate[]> {
  const candidates: CodexSkillCandidate[] = [];
  for (const candidate of await listSkillCandidates(ports, harnessSkills)) {
    const port = candidate.hasSkillMd
      ? await ports.inspect(`${codexPortTarget(harnessSkills, candidate.name)}/SKILL.md`)
      : { kind: "missing" as const };
    candidates.push({ ...candidate, hasCodexPort: port.kind === "file" });
  }
  return candidates;
}

async function planCodexSkillsDir(
  ports: CodexApplyPorts,
  paths: CodexApplyPaths,
  now: Date,
): Promise<ManagedDirReport> {
  const sourceDir = `${paths.harnessRoot}/skills`;
  const selection = selectCodexSkillPorts(await listCodexSkillCandidates(ports, sourceDir));
  return planManagedDir(ports, {
    dir: paths.codexSkills,
    sourceDir,
    selection,
    now,
    targetOf: (name) => codexPortTarget(sourceDir, name),
    formerSourceDirs: paths.formerSkillRoots,
    probeDangling: true,
  });
}

/** yoki's command→skill conversions: real `cmd-*` directories under `~/.codex/skills`. */
export function yokiCommandLeftovers(
  report: ManagedDirReport,
): readonly { readonly name: string; readonly path: string }[] {
  return report.entries.flatMap((entry) =>
    entry.kind === "foreign" && entry.name.startsWith("cmd-") && entry.what === "a directory"
      ? [{ name: entry.name, path: entry.path }]
      : [],
  );
}

async function planAgents(
  ports: CodexApplyPorts,
  paths: CodexApplyPaths,
  options: CodexApplyOptions,
  manifest: Readonly<Record<string, string>>,
  now: Date,
): Promise<AgentsDirReport> {
  const sourceDir = `${paths.harnessRoot}/agents`;
  const candidates: readonly AgentCandidate[] = await listEntries(ports, sourceDir);
  const selection = selectAgentFiles(candidates);

  const files: AgentFileReport[] = [];
  const produced = new Set<string>();
  const unmapped = new Map<string, number>();
  for (const sourceFile of selection.linked) {
    const text = await ports.readFile(`${sourceDir}/${sourceFile}`);
    if (text === undefined) continue;
    const stem = sourceFile.replace(/\.md$/, "");
    const definition = parseAgentDefinition(text, stem);
    const model = codexModelFor(definition.model, options.codexModels);
    if (model.kind === "unmapped") unmapped.set(model.tier, (unmapped.get(model.tier) ?? 0) + 1);
    const content = renderCodexAgent({
      definition,
      model,
      sourcePath: `${sourceDir}/${sourceFile}`,
    });
    options.validateToml?.(content);
    const name = codexAgentFileName(sourceFile);
    const path = `${paths.agentsDir}/${name}`;
    produced.add(name);
    const current = await ports.readFile(path);
    const plan = planApply({
      currentContent: current,
      generatedContent: content,
      manifestHash: manifest[path],
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
      ...(plan.action === "write" && current !== undefined && manifest[path] === undefined
        ? { backupPath: backupPath(path, now) }
        : {}),
    });
  }

  const foreign = (await listEntries(ports, paths.agentsDir))
    .filter((entry) => !produced.has(entry.name))
    .map((entry) => ({ name: entry.name, what: describePathState(entry.state) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    path: paths.agentsDir,
    files,
    excluded: selection.excluded,
    foreign,
    unmappedTiers: [...unmapped.entries()]
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => b.count - a.count),
  };
}

async function planConfigToml(
  ports: CodexApplyPorts,
  paths: CodexApplyPaths,
  options: CodexApplyOptions,
  manifest: Readonly<Record<string, string>>,
): Promise<{ readonly report: ConfigTomlReport; readonly generated: string }> {
  const read = await readJson(ports, paths.mcpServers);
  if (read === undefined) {
    throw new Error(`jig apply --target codex: MCP source not found at ${paths.mcpServers}`);
  }
  const layer = parseMcpLayer(read.text, paths.mcpServers);
  const tables = buildCodexMcpTables(layer.servers, { HOME: paths.home });
  const block = renderMcpBlock(tables);

  const current = await ports.readFile(paths.configToml);
  const plan = planMcpBlock(current, block);
  const names = tables.map((table) => table.name);
  const declaredOutside = current === undefined ? [] : mcpServersDeclaredOutside(current, names);
  // A table declared twice is exactly what the parser rejects, and it is
  // reported as the conflict it is; the parser's own error would only hide
  // the names. So the generated text is validated only once it could load.
  if (declaredOutside.length === 0) options.validateToml?.(plan.configToml);
  const blockPlan = planApply({
    currentContent: plan.currentBlock,
    generatedContent: block,
    manifestHash: manifest[paths.configToml],
    sha256: ports.sha256,
  });
  return {
    generated: plan.configToml,
    report: {
      path: paths.configToml,
      outcome: blockPlan.action,
      diff: unifiedDiff(paths.configToml, current ?? "", "generated", plan.configToml),
      servers: names,
      block,
      declaredOutside,
      yokiLeftovers: current === undefined ? [] : yokiLeftovers(current),
    },
  };
}

function needsWrite(report: Omit<CodexApplyReport, "outcome" | "wrote" | "message">): boolean {
  return (
    managedDirChanges(report.agentsSkillsDir) ||
    managedDirChanges(report.codexSkillsDir) ||
    report.agentsMd.outcome === "write" ||
    report.agents.files.some((file) => file.outcome === "write") ||
    report.configToml.outcome === "write"
  );
}

export async function applyCodex(
  input: {
    readonly paths: CodexApplyPaths;
    readonly options: CodexApplyOptions;
    readonly write: boolean;
  },
  ports: CodexApplyPorts,
): Promise<CodexApplyReport> {
  const { paths, options } = input;
  const manifest = { ...(await ports.readManifest()) };
  const now = ports.now();

  const agentsMd = await planAgentsMd(ports, {
    path: paths.agentsMd,
    generated: await buildAgentsMd(ports, paths),
    manifest,
    now,
  });
  const agents = await planAgents(ports, paths, options, manifest, now);
  const config = await planConfigToml(ports, paths, options, manifest);

  const base = {
    agentsSkillsDir: await planAgentsSkillsMount(ports, paths, "codex", now),
    codexSkillsDir: await planCodexSkillsDir(ports, paths, now),
    agentsMd,
    agents,
    configToml: config.report,
    hooksJson: paths.hooksJson,
  };

  const conflicts: string[] = [
    ...(agentsMd.outcome === "conflict"
      ? ["AGENTS.md differs from both jig's last write and the newly generated content"]
      : []),
    ...agents.files
      .filter((file) => file.outcome === "conflict")
      .map(
        (file) =>
          `agents/${file.name} differs from both jig's last write and the newly generated content`,
      ),
    ...(config.report.outcome === "conflict"
      ? [
          "config.toml's jig MCP block differs from both jig's last write and the newly generated block",
        ]
      : []),
    ...config.report.declaredOutside.map(
      (table) =>
        `config.toml declares [mcp_servers.${table.name}] outside jig's block (line ${table.line}); remove it by hand before --write`,
    ),
  ];
  if (conflicts.length > 0) {
    return {
      ...base,
      outcome: "conflict",
      wrote: false,
      message: `conflict: ${conflicts.join("; ")} — reconcile before --write`,
    };
  }

  const changes = needsWrite(base);
  if (input.write && changes) {
    if (agentsMd.outcome === "write") await applyAgentsMd(ports, agentsMd, manifest);
    for (const file of agents.files) {
      if (file.outcome !== "write") continue;
      if (file.backupPath !== undefined) await ports.rename(file.path, file.backupPath);
      await ports.writeAtomic(file.path, file.content);
      manifest[file.path] = ports.sha256(file.content);
    }
    if (config.report.outcome === "write") {
      await ports.writeAtomic(paths.configToml, config.generated);
      manifest[paths.configToml] = ports.sha256(config.report.block);
    }
    seedManifest(ports, manifest, base);
    await ports.writeManifest(manifest);
    await ports.writeProvenance(dirOf(paths.configToml), {
      sourceFile: paths.mcpServers,
      sourceSha256: ports.sha256((await ports.readFile(paths.mcpServers)) ?? ""),
      generatedAt: now.toISOString(),
      jigVersion: ports.jigVersion,
    });
    await applyManagedDir(ports, base.agentsSkillsDir);
    await applyManagedDir(ports, base.codexSkillsDir);
    return { ...base, outcome: "write", wrote: true };
  }

  if (input.write && !changes && seedManifest(ports, manifest, base)) {
    // Nothing to deliver, but the generated files were already current: seed
    // their hashes so a LATER hand edit is detected as one. Out-of-repo
    // state only; no file content changes.
    await ports.writeManifest(manifest);
  }

  return { ...base, outcome: changes ? "write" : "noop", wrote: false };
}

/** Record every generated file's hash that is not recorded yet. True when anything was added. */
function seedManifest(
  ports: CodexApplyPorts,
  manifest: Record<string, string>,
  report: Pick<CodexApplyReport, "agentsMd" | "agents" | "configToml">,
): boolean {
  let added = false;
  const seed = (path: string, content: string) => {
    if (manifest[path] !== undefined) return;
    manifest[path] = ports.sha256(content);
    added = true;
  };
  seed(report.agentsMd.path, report.agentsMd.content);
  for (const file of report.agents.files) seed(file.path, file.content);
  seed(report.configToml.path, report.configToml.block);
  return added;
}
