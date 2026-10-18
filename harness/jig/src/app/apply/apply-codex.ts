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
 *   else is not jig's. It is the only skills delivery Codex gets: the
 *   Codex-specific ports (`skills/<name>/codex/SKILL.md`) were dropped by
 *   the ruling of 2026-09-23, so `~/.codex/skills/` is not managed by jig at
 *   all — its entries (yoki's port links and `cmd-*` directories, Codex's
 *   bundled `.system/`) are listed in the dry-run as leftovers for
 *   milestone 4 and never touched.
 * - `~/.codex/AGENTS.md` — the same generated content as
 *   `~/.claude/AGENTS.md`, from the same renderer: one source, two
 *   destinations, no vocabulary substitution. yoki's file there is backed
 *   up before the first generated one lands, as the Claude target does.
 * - `~/.codex/agents/<name>.toml` — one generated file per `agents/*.md`
 *   and per skill pack agent, the house keeping a shared name
 *   (`domain/codex/agents.ts`, `./plugins.ts`), each tracked in the manifest so a hand edit
 *   is a conflict. `model` and `model_reasoning_effort` come from the
 *   `codex` table of `agents/models.json` (`domain/claude/agent-models.ts`,
 *   read at the composition root) or the agent's own `models.codex`
 *   override; a tier the table does not know leaves `model` out and is
 *   counted. A file there that no source produces is not jig's.
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

import type { ModelMapping } from "../../domain/claude/agent-definition";
import { checkAgentVocabulary } from "../../domain/claude/agent-definition";
import { type PathState, backupPath } from "../../domain/claude/links";
import { describePathState } from "../../domain/claude/managed-dir";
import {
  type CodexModelChoice,
  codexAgentFileName,
  codexModelFor,
  parseAgentDefinition,
  renderCodexAgent,
} from "../../domain/codex/agents";
import {
  buildCodexMcpTables,
  ownedView,
  planMcpBlock,
  renderMcpBlock,
  serversDeclaredAsKeys,
  yokiLeftovers,
} from "../../domain/codex/config";
import { parseMcpLayer } from "../../domain/mcp/parse";
import { unifiedDiff } from "../../domain/tiers/diff";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import {
  type AgentsMdReport,
  type AgentsSkillsMountReport,
  applyAgentsMd,
  applyManagedDir,
  buildAgentsMd,
  dirOf,
  listEntries,
  managedDirChanges,
  planAgentsMd,
  planAgentsSkillsMount,
  readJson,
} from "./delivery";
import {
  type StaleAgentFile,
  fromPack,
  reasonOf,
  removeStale,
  sortLeftovers,
} from "./generated-agents";
import { agentPlan, loadPlugins } from "./plugins";
import type { CodexApplyPorts } from "./ports";

export interface CodexApplyPaths {
  /** `llm/harness/`, absolute. `skills/`, `agents/` and `rules/` are under it. */
  readonly harnessRoot: string;
  /** Where external skill packs are checked out (`resolvePluginsDir`). Absent: none. */
  readonly pluginsDir?: string;
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
  /** `~/.codex/skills`: not managed by jig; its entries are reported as leftovers only. */
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

/** One tier of the mapping in use and how many agents it decided. */
export interface MappedTierReport {
  readonly tier: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly count: number;
}

export interface AgentsDirReport {
  readonly path: string;
  readonly files: readonly AgentFileReport[];
  /** Source entries that produce no file, with why. */
  readonly excluded: readonly { readonly name: string; readonly reason: string }[];
  /** Files jig wrote whose source is gone, unchanged since: removed on `--write`. */
  readonly stale: readonly StaleAgentFile[];
  /** Entries of the destination that no source produces: not jig's, or edited since jig wrote them. Left alone. */
  readonly foreign: readonly { readonly name: string; readonly what: string }[];
  /** Where the tier table came from, when the caller said. */
  readonly mappingSource?: string;
  /** Source tiers the table maps, with what they map to and how many agents each decided. Most agents first. */
  readonly mappedTiers: readonly MappedTierReport[];
  /** Source tiers with no Codex model, and how many agents name each. */
  readonly unmappedTiers: readonly { readonly tier: string; readonly count: number }[];
}

/** One entry of `~/.codex/skills`, named and left alone. */
export interface CodexSkillsLeftover {
  readonly name: string;
  readonly path: string;
  readonly what: string;
  /** Whose it is, and why jig leaves it. */
  readonly note: string;
}

/** `~/.codex/skills` as found: not a destination, a listing for milestone 4. */
export interface CodexSkillsReport {
  readonly path: string;
  readonly state: PathState;
  readonly entries: readonly CodexSkillsLeftover[];
}

export interface ConfigTomlReport {
  readonly path: string;
  readonly outcome: PlanAction;
  readonly diff: string;
  /** Servers the block carries, in source order. */
  readonly servers: readonly string[];
  readonly block: string;
  /** Servers jig writes that the file declares as keys of a bare `[mcp_servers]`: conflicts. */
  readonly declaredAsKeys: readonly string[];
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
  /** `~/.codex/skills`, reported only. */
  readonly codexSkills: CodexSkillsReport;
  readonly agentsMd: AgentsMdReport;
  readonly agents: AgentsDirReport;
  readonly configToml: ConfigTomlReport;
  /** Reported only: `jig codex register` owns it. */
  readonly hooksJson: string;
  readonly message?: string;
}

export interface CodexApplyOptions {
  /**
   * Claude tier name (`haiku`/`sonnet`/`opus`, lower-cased) → Codex model and
   * reasoning effort: the `codex` table of `agents/models.json`. Empty means
   * every tier is a reported gap.
   */
  readonly codexModels: Readonly<Record<string, ModelMapping>>;
  /** Where `codexModels` was read from, for the dry-run. */
  readonly modelsSource?: string;
  /** Called with each generated TOML text before writing; throw to refuse. */
  readonly validateToml?: (text: string) => void;
  /**
   * A TOML parser. Given, jig's part of config.toml is compared by value
   * (`ownedView`), so Codex rewriting its tables (dropping `args = []`,
   * regrouping) is not taken for a hand edit. Absent, the text is compared.
   */
  readonly parseToml?: (text: string) => unknown;
}

/** yoki's command→skill conversions: real `cmd-*` directories. */
function isYokiCommandDir(name: string, state: PathState): boolean {
  return name.startsWith("cmd-") && state.kind === "dir";
}

/** Codex's bundled skills live under `.system/` in the same directory. */
const CODEX_SYSTEM_SKILLS = ".system";

function leftoverNote(name: string, state: PathState): string {
  if (name === CODEX_SYSTEM_SKILLS) return "Codex's bundled skills; Codex's own";
  if (isYokiCommandDir(name, state)) {
    return "yoki's command→skill conversion; commands are skills, delivered through ~/.agents/skills";
  }
  if (state.kind === "symlink") {
    return "yoki's link to a codex/SKILL.md port; ports are dropped, the skill reaches Codex through ~/.agents/skills";
  }
  return "not jig's";
}

/**
 * What stands under `~/.codex/skills` today. Nothing is planned for the
 * directory: Codex reads every skill from `~/.agents/skills` like pi and omp,
 * and the Codex-specific ports are gone. Each entry is named with whose it
 * is, so the hand cleanup of milestone 4 has its list.
 */
async function reportCodexSkills(
  ports: CodexApplyPorts,
  paths: CodexApplyPaths,
): Promise<CodexSkillsReport> {
  const state = await ports.inspect(paths.codexSkills);
  const entries =
    state.kind === "dir"
      ? (await listEntries(ports, paths.codexSkills))
          .map((entry) => ({
            name: entry.name,
            path: `${paths.codexSkills}/${entry.name}`,
            what: describePathState(entry.state),
            note: leftoverNote(entry.name, entry.state),
          }))
          .sort((a, b) => compare(a.name, b.name))
      : [];
  return { path: paths.codexSkills, state, entries };
}

async function planAgents(
  ports: CodexApplyPorts,
  paths: CodexApplyPaths,
  options: CodexApplyOptions,
  manifest: Readonly<Record<string, string>>,
  now: Date,
): Promise<AgentsDirReport> {
  const sourceDir = `${paths.harnessRoot}/agents`;
  const plugins = await loadPlugins(ports, paths.harnessRoot, paths.pluginsDir);
  const { selection, targetOf } = await agentPlan(ports, sourceDir, plugins);

  const files: AgentFileReport[] = [];
  const excluded = [...selection.excluded];
  const produced = new Set<string>();
  const mapped = new Map<string, MappedTierReport>();
  const unmapped = new Map<string, number>();
  for (const sourceFile of selection.linked) {
    const sourcePath = targetOf(sourceFile);
    const text = await ports.readFile(sourcePath);
    if (text === undefined) continue;
    const stem = sourceFile.replace(/\.md$/, "");
    let built: { model: CodexModelChoice; content: string };
    try {
      const { definition, model } = decide(sourceFile, () => {
        const parsed = parseAgentDefinition(text, stem);
        if (!fromPack(sourcePath, sourceDir)) checkAgentVocabulary(parsed);
        return {
          definition: parsed,
          model: codexModelFor(parsed.model, options.codexModels, parsed.models?.codex),
        };
      });
      const content = renderCodexAgent({ definition, model, sourcePath });
      options.validateToml?.(content);
      built = { model, content };
    } catch (error) {
      if (!fromPack(sourcePath, sourceDir)) throw error;
      excluded.push({ name: sourceFile, reason: reasonOf(error) });
      continue;
    }
    const { model, content } = built;
    if (model.kind === "unmapped") unmapped.set(model.tier, (unmapped.get(model.tier) ?? 0) + 1);
    if (model.kind === "mapped" && model.override === undefined && model.tier !== undefined) {
      const seen = mapped.get(model.tier);
      mapped.set(model.tier, {
        tier: model.tier,
        model: model.model,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
        count: (seen?.count ?? 0) + 1,
      });
    }
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

  const { stale, foreign } = await sortLeftovers(ports, paths.agentsDir, produced, manifest);

  return {
    path: paths.agentsDir,
    files,
    excluded,
    stale,
    foreign,
    ...(options.modelsSource === undefined ? {} : { mappingSource: options.modelsSource }),
    mappedTiers: [...mapped.values()].sort((a, b) => b.count - a.count),
    unmappedTiers: [...unmapped.entries()]
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** A source that cannot be read is an error naming the file, not a silently skipped agent. */
function decide<T>(sourceFile: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`jig apply --target codex: agents/${sourceFile}: ${reason}`);
  }
}

async function planConfigToml(
  ports: CodexApplyPorts,
  paths: CodexApplyPaths,
  options: CodexApplyOptions,
  manifest: Readonly<Record<string, string>>,
): Promise<{
  readonly report: ConfigTomlReport;
  readonly generated: string;
  readonly ownedHash: string | undefined;
}> {
  const read = await readJson(ports, paths.mcpServers);
  if (read === undefined) {
    throw new Error(`jig apply --target codex: MCP source not found at ${paths.mcpServers}`);
  }
  const layer = parseMcpLayer(read.text, paths.mcpServers);
  const tables = buildCodexMcpTables(layer.servers, { HOME: paths.home });
  const block = renderMcpBlock(tables);

  const current = await ports.readFile(paths.configToml);
  const names = tables.map((table) => table.name);
  const asKeys = current === undefined ? [] : serversDeclaredAsKeys(current, names);
  const plan = planMcpBlock(current, tables, previousMcpNames(manifest, paths));
  // a server also declared as a key of [mcp_servers] would make the result
  // a duplicate the parser rejects; that is reported as the conflict below
  if (asKeys.length === 0) options.validateToml?.(plan.configToml);
  const compared = comparedForms(ports, paths, options, manifest, {
    current,
    currentBlock: plan.currentBlock,
    block,
    owned: [...new Set([...names, ...previousMcpNames(manifest, paths)])],
  });
  const applied = planApply({ ...compared, sha256: ports.sha256 });
  // Tables under jig's names that jig has no record of writing (yoki's, or
  // written by hand) are somebody's: they are not taken over silently.
  const blockPlan =
    compared.manifestHash === undefined &&
    compared.currentContent !== undefined &&
    compared.currentContent !== compared.generatedContent
      ? { action: "conflict" as const }
      : applied;
  return {
    generated: plan.configToml,
    ownedHash: compared.byValue ? ports.sha256(compared.generatedContent) : undefined,
    report: {
      path: paths.configToml,
      outcome: blockPlan.action,
      diff: unifiedDiff(paths.configToml, current ?? "", "generated", plan.configToml),
      servers: names,
      block,
      declaredAsKeys: asKeys,
      yokiLeftovers: current === undefined ? [] : yokiLeftovers(current),
    },
  };
}

/** Where the manifest keeps the hash of jig's part of config.toml, by value. */
function ownedKey(paths: CodexApplyPaths): string {
  return `${paths.configToml}#owned`;
}

/**
 * What the hand-edit check compares. With a parser: jig's part of the file
 * by value, against the value-hash jig recorded; before such a hash exists,
 * the text-block hash an older apply recorded still vouches for the file
 * when the text matches it. Without a parser, or when the file does not
 * parse: the canonical text block, as before.
 */
function comparedForms(
  ports: CodexApplyPorts,
  paths: CodexApplyPaths,
  options: CodexApplyOptions,
  manifest: Readonly<Record<string, string>>,
  input: {
    readonly current: string | undefined;
    readonly currentBlock: string | undefined;
    readonly block: string;
    readonly owned: readonly string[];
  },
): {
  readonly currentContent: string | undefined;
  readonly generatedContent: string;
  readonly manifestHash: string | undefined;
  readonly byValue: boolean;
} {
  const byText = {
    currentContent: input.currentBlock,
    generatedContent: input.block,
    manifestHash: manifest[paths.configToml],
    byValue: false,
  };
  const parse = options.parseToml;
  if (parse === undefined) return byText;
  let parsedCurrent: unknown;
  try {
    parsedCurrent = input.current === undefined ? {} : parse(input.current);
  } catch {
    return byText;
  }
  const currentView = ownedView(parsedCurrent, input.owned);
  const generatedView = ownedView(parse(input.block), input.owned) ?? "";
  const recorded = manifest[ownedKey(paths)];
  const legacy = manifest[paths.configToml];
  const vouched =
    recorded === undefined &&
    legacy !== undefined &&
    input.currentBlock !== undefined &&
    ports.sha256(input.currentBlock) === legacy &&
    currentView !== undefined;
  return {
    currentContent: currentView,
    generatedContent: generatedView,
    manifestHash:
      recorded ?? (vouched && currentView !== undefined ? ports.sha256(currentView) : legacy),
    byValue: true,
  };
}

/** Where the manifest keeps the server names jig wrote, so a server dropped from the source is removed. */
function mcpNamesKey(paths: CodexApplyPaths): string {
  return `${paths.configToml}#mcpServers`;
}

function previousMcpNames(
  manifest: Readonly<Record<string, string>>,
  paths: CodexApplyPaths,
): readonly string[] {
  const recorded = manifest[mcpNamesKey(paths)];
  if (recorded === undefined) return [];
  try {
    const names: unknown = JSON.parse(recorded);
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

function needsWrite(report: Omit<CodexApplyReport, "outcome" | "wrote" | "message">): boolean {
  return (
    managedDirChanges(report.agentsSkillsDir) ||
    report.agentsMd.outcome === "write" ||
    report.agents.files.some((file) => file.outcome === "write") ||
    report.agents.stale.length > 0 ||
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
    codexSkills: await reportCodexSkills(ports, paths),
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
    ...config.report.declaredAsKeys.map(
      (name) =>
        `config.toml declares ${name} as a key of [mcp_servers], not as [mcp_servers.${name}]; move or remove it by hand before --write`,
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
    await removeStale(ports, agents.stale, manifest);
    if (config.report.outcome === "write") {
      await ports.writeAtomic(paths.configToml, config.generated);
      manifest[paths.configToml] = ports.sha256(config.report.block);
      manifest[mcpNamesKey(paths)] = JSON.stringify(config.report.servers);
      if (config.ownedHash !== undefined) manifest[ownedKey(paths)] = config.ownedHash;
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
    return { ...base, outcome: "write", wrote: true };
  }

  const seededConfig =
    input.write && !changes && config.report.outcome === "noop"
      ? seedConfigRecords(manifest, paths, config)
      : false;
  if (input.write && !changes && (seedManifest(ports, manifest, base) || seededConfig)) {
    // Nothing to deliver, but the generated files were already current: seed
    // their hashes so a LATER hand edit is detected as one. Out-of-repo
    // state only; no file content changes.
    await ports.writeManifest(manifest);
  }

  return { ...base, outcome: changes ? "write" : "noop", wrote: false };
}

/**
 * When config.toml already holds exactly what jig would write, record the
 * names and the by-value hash an older apply did not keep, so the next
 * Codex rewrite is compared by value and not mistaken for a hand edit.
 */
function seedConfigRecords(
  manifest: Record<string, string>,
  paths: CodexApplyPaths,
  config: { readonly report: ConfigTomlReport; readonly ownedHash: string | undefined },
): boolean {
  let added = false;
  if (manifest[mcpNamesKey(paths)] === undefined) {
    manifest[mcpNamesKey(paths)] = JSON.stringify(config.report.servers);
    added = true;
  }
  if (config.ownedHash !== undefined && manifest[ownedKey(paths)] === undefined) {
    manifest[ownedKey(paths)] = config.ownedHash;
    added = true;
  }
  return added;
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

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
