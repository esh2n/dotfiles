/**
 * `jig apply --target omp` — deliver the omp (oh-my-pi) configuration from
 * the sources under `llm/harness/`, and either show what would change
 * (default) or do it (`--write`). Milestone 3b of the generator that retires
 * `yoki-switch`; the same shape as `./apply-codex.ts`, over omp's agent
 * directory (`~/.omp/agent`, or the active profile's — `domain/omp/agent-dir.ts`)
 * and the cross-harness skills mount.
 *
 * - `~/.agents/skills/` — the managed directory of links the Codex target
 *   delivers too, planned by the one function both call
 *   (`planAgentsSkillsMount`, `./delivery.ts`). omp reads it natively (its
 *   `agents` provider), so skills need no omp-specific delivery.
 * - `~/.omp/agent/agents/<name>.md` — one generated file per `agents/*.md`
 *   (`domain/omp/agents.ts`): frontmatter translated, body verbatim. Each is
 *   tracked in the manifest so a hand edit is a conflict; the files yoki
 *   generated there today are backed up before the first generated ones
 *   land; a file no source produces is not jig's.
 * - `~/.omp/agent/mcp.json` — jig's entries of `mcpServers` for every server
 *   with `targets.omp` (`domain/omp/mcp.ts`); every other entry and every
 *   other top-level key carried through and named. Per
 *   `rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md` omp gets
 *   the full list: its MCP client is lazy (`xdev`), so a server costs
 *   nothing until called.
 * - `~/.omp/agent/extensions/jig.ts` — a symlink to jig's omp extension,
 *   `adapters/omp/src/index.ts`, which omp's native discovery loads directly
 *   (docs/extension-loading.md: `<agentDir>/extensions` is scanned for
 *   `*.{ts,js}`, "symlinks are treated as eligible files/directories", and
 *   omp runs TypeScript without a build step — see `adapters/omp/README.md`,
 *   "Installing it"). The other entries of that directory are not jig's;
 *   yoki's two links there are reported as leftovers, not removed.
 * - Report only: `~/.omp/agent/{yoki-hooks.json,RULES.md,.yoki/,config.yml}`
 *   are yoki's, left for milestone 4. jig does not own `config.yml` in this
 *   milestone at all — omp's approval policy there is a ruling not yet made.
 *   Skills and the instructions file reach omp natively (`~/.agents/skills`,
 *   `~/.claude/CLAUDE.md`); the conditional `paths:` rules do not reach omp
 *   in this milestone, and the dry-run names that gap.
 *
 * The invariant is the Claude target's: sources → output, one way. The
 * destination is read to carry through what jig does not own and to say
 * what `--write` would do to what is there. One conflict anywhere stops the
 * whole write.
 */

import {
  type ModelChoice,
  modelChoiceFor,
  parseAgentDefinition,
} from "../../domain/claude/agent-definition";
import { type AgentCandidate, selectAgentFiles } from "../../domain/claude/agents-dir";
import { type PathState, backupPath, planLink } from "../../domain/claude/links";
import { describePathState } from "../../domain/claude/managed-dir";
import { parseMcpLayer } from "../../domain/mcp/parse";
import {
  type OmpToolTranslation,
  ompAgentFileName,
  ompAgentFrontmatter,
  renderOmpAgent,
  translateTools,
} from "../../domain/omp/agents";
import { buildOmpMcpServers, planOmpMcpJson } from "../../domain/omp/mcp";
import { unifiedDiff } from "../../domain/tiers/diff";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import {
  type AgentsSkillsMountReport,
  type LinkReport,
  applyLink,
  applyManagedDir,
  listEntries,
  managedDirChanges,
  planAgentsSkillsMount,
  readJson,
  withBackup,
} from "./delivery";
import type { OmpApplyPorts } from "./ports";

/** The link's name under `extensions/`: omp derives the extension id `extension-module:jig` from it. */
export const OMP_EXTENSION_LINK_NAME = "jig.ts";

export interface OmpApplyPaths {
  /** `llm/harness/`, absolute. `skills/` and `agents/` are under it. */
  readonly harnessRoot: string;
  /** `llm/harness/mcp/servers.json`. */
  readonly mcpServers: string;
  /** The trees yoki-switch linked skills from: a link under one of them is stale, not somebody's. */
  readonly formerSkillRoots: readonly string[];
  /** Destination: `~/.agents/skills`, the cross-harness mount, one link per skill. */
  readonly agentsSkills: string;
  /** omp's agent directory: `~/.omp/agent`, or the active profile's. Everything below is under it. */
  readonly agentDir: string;
  /** Destination: `<agentDir>/agents/`, one generated `<name>.md` per agent. */
  readonly agentsDir: string;
  /** Destination: `<agentDir>/mcp.json`; only jig's entries are written. */
  readonly mcpJson: string;
  /** `<agentDir>/extensions/`, where the one link goes. */
  readonly extensionsDir: string;
  /** Source: `jig/adapters/omp/src/index.ts`, absolute — the link's target. */
  readonly extensionTarget: string;
  /** Substituted into mcp command paths; `{{HOME}}`. */
  readonly home: string;
}

export type OmpOutcome = "write" | "noop" | "conflict";

/** One generated `<agentDir>/agents/<name>.md`. */
export interface OmpAgentFileReport {
  readonly name: string;
  readonly path: string;
  readonly sourceFile: string;
  readonly content: string;
  readonly outcome: PlanAction;
  readonly model: ModelChoice;
  readonly tools: OmpToolTranslation;
  /** Set when a file jig never wrote stands at the path: renamed to this before the generated one lands. */
  readonly backupPath?: string;
}

export interface OmpAgentsDirReport {
  readonly path: string;
  readonly files: readonly OmpAgentFileReport[];
  /** Source entries that produce no file, with why. */
  readonly excluded: readonly { readonly name: string; readonly reason: string }[];
  /** Entries of the destination that no source produces: not jig's, left alone. */
  readonly foreign: readonly { readonly name: string; readonly what: string }[];
  /** Source tiers with no omp model, and how many agents name each. */
  readonly unmappedTiers: readonly { readonly tier: string; readonly count: number }[];
  /** Claude tool names with no omp tool, and how many agents name each. */
  readonly unmappedTools: readonly { readonly tool: string; readonly count: number }[];
}

export interface OmpMcpJsonReport {
  readonly path: string;
  readonly outcome: PlanAction;
  readonly diff: string;
  /** Servers jig writes, in source order. */
  readonly servers: readonly string[];
  /** Entries in the file that no source produces: carried through. */
  readonly foreign: readonly string[];
  /** Top-level keys other than `mcpServers` carried through. */
  readonly carried: readonly string[];
  readonly block: string;
  /** The file could not be read as a JSON object; a conflict. */
  readonly invalid?: string;
}

/** `<agentDir>/extensions/`: jig's one link, yoki's two, and everything else. */
export interface OmpExtensionsReport {
  readonly path: string;
  /** The directory itself, as found. A regular file there is a conflict. */
  readonly dirState: PathState;
  readonly link: LinkReport;
  /** yoki's `yoki-*.ts` entries, named for milestone 4. */
  readonly yokiLeftovers: readonly { readonly name: string; readonly what: string }[];
  /** Anything else: not jig's. */
  readonly foreign: readonly { readonly name: string; readonly what: string }[];
}

/** A path under the agent directory yoki wrote and jig does not own. */
export interface OmpLeftover {
  readonly name: string;
  readonly path: string;
  readonly what: string;
  readonly note: string;
}

export interface OmpApplyReport {
  /** Over all parts: any conflict wins; then any change; then noop. */
  readonly outcome: OmpOutcome;
  /** True when `--write` applied the delivery. Never true with a conflict anywhere. */
  readonly wrote: boolean;
  readonly agentsSkillsDir: AgentsSkillsMountReport;
  readonly agents: OmpAgentsDirReport;
  readonly mcpJson: OmpMcpJsonReport;
  readonly extensions: OmpExtensionsReport;
  /** yoki's files under the agent directory that exist today, left alone. */
  readonly yokiLeftovers: readonly OmpLeftover[];
  readonly message?: string;
}

export interface OmpApplyOptions {
  /** Claude tier name (`haiku`/`sonnet`/`opus`) → omp model selector. Empty until a ruling supplies one. */
  readonly ompModels: Readonly<Record<string, string>>;
  /** Called with each generated file's frontmatter (YAML) before writing; throw to refuse. */
  readonly validateFrontmatter?: (yaml: string) => void;
}

/** yoki's files under the agent directory, and why each is reported rather than touched. */
const YOKI_LEFTOVER_NOTES: readonly { readonly name: string; readonly note: string }[] = [
  { name: "yoki-hooks.json", note: "yoki's hook registry; jig's hooks are the extension" },
  {
    name: "RULES.md",
    note: "yoki's sticky rules (omp loads it as an always-apply rule); jig delivers rules through ~/.claude/CLAUDE.md",
  },
  { name: ".yoki", note: "yoki's manifest and permission set" },
  {
    name: "config.yml",
    note: "omp's settings, generated by yoki; jig does not own config.yml in this milestone",
  },
];

async function planAgents(
  ports: OmpApplyPorts,
  paths: OmpApplyPaths,
  options: OmpApplyOptions,
  manifest: Readonly<Record<string, string>>,
  now: Date,
): Promise<OmpAgentsDirReport> {
  const sourceDir = `${paths.harnessRoot}/agents`;
  const candidates: readonly AgentCandidate[] = await listEntries(ports, sourceDir);
  const selection = selectAgentFiles(candidates);

  const files: OmpAgentFileReport[] = [];
  const produced = new Set<string>();
  const unmappedTiers = new Map<string, number>();
  const unmappedTools = new Map<string, number>();
  for (const sourceFile of selection.linked) {
    const text = await ports.readFile(`${sourceDir}/${sourceFile}`);
    if (text === undefined) continue;
    const stem = sourceFile.replace(/\.md$/, "");
    const definition = parseAgentDefinition(text, stem);
    const model = modelChoiceFor(definition.model, options.ompModels);
    if (model.kind === "unmapped") {
      unmappedTiers.set(model.tier, (unmappedTiers.get(model.tier) ?? 0) + 1);
    }
    const tools = translateTools(definition.tools);
    for (const tool of tools.unmapped) unmappedTools.set(tool, (unmappedTools.get(tool) ?? 0) + 1);
    const content = renderOmpAgent({
      definition,
      model,
      tools,
      sourcePath: `${sourceDir}/${sourceFile}`,
    });
    options.validateFrontmatter?.(ompAgentFrontmatter(content));
    const name = ompAgentFileName(sourceFile);
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
      tools,
      // A file jig has no record of writing is somebody's, until proven otherwise.
      ...(plan.action === "write" && current !== undefined && manifest[path] === undefined
        ? { backupPath: backupPath(path, now) }
        : {}),
    });
  }

  const foreign = (await listEntries(ports, paths.agentsDir))
    .filter((entry) => !produced.has(entry.name))
    .map((entry) => ({ name: entry.name, what: describePathState(entry.state) }))
    .sort((a, b) => compare(a.name, b.name));

  const counted = (map: Map<string, number>) =>
    [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

  return {
    path: paths.agentsDir,
    files,
    excluded: selection.excluded,
    foreign,
    unmappedTiers: counted(unmappedTiers).map(({ key, count }) => ({ tier: key, count })),
    unmappedTools: counted(unmappedTools).map(({ key, count }) => ({ tool: key, count })),
  };
}

async function planMcpJson(
  ports: OmpApplyPorts,
  paths: OmpApplyPaths,
  manifest: Readonly<Record<string, string>>,
): Promise<{ readonly report: OmpMcpJsonReport; readonly generated: string }> {
  const read = await readJson(ports, paths.mcpServers);
  if (read === undefined) {
    throw new Error(`jig apply --target omp: MCP source not found at ${paths.mcpServers}`);
  }
  const layer = parseMcpLayer(read.text, paths.mcpServers);
  const entries = buildOmpMcpServers(layer.servers, { HOME: paths.home });
  const current = await ports.readFile(paths.mcpJson);
  const plan = planOmpMcpJson(current, entries);
  const blockPlan =
    plan.invalid === undefined
      ? planApply({
          currentContent: plan.currentBlock,
          generatedContent: plan.block,
          manifestHash: manifest[paths.mcpJson],
          sha256: ports.sha256,
        })
      : { action: "conflict" as const };
  return {
    generated: plan.text,
    report: {
      path: paths.mcpJson,
      outcome: blockPlan.action,
      diff: unifiedDiff(paths.mcpJson, current ?? "", "generated", plan.text),
      servers: entries.map((entry) => entry.name),
      foreign: plan.foreign,
      carried: plan.carried,
      block: plan.block,
      ...(plan.invalid === undefined ? {} : { invalid: plan.invalid }),
    },
  };
}

/** yoki's `yoki-*.ts` links, by name: what yoki-switch installs there today (`yoki-bridge.ts`, `yoki-guard.ts`). */
function isYokiExtension(name: string): boolean {
  return /^yoki-.*\.(ts|js)$/.test(name);
}

async function planExtensions(
  ports: OmpApplyPorts,
  paths: OmpApplyPaths,
  now: Date,
): Promise<OmpExtensionsReport> {
  const dirState = await ports.inspect(paths.extensionsDir);
  const path = `${paths.extensionsDir}/${OMP_EXTENSION_LINK_NAME}`;
  const link = withBackup(planLink(path, paths.extensionTarget, await ports.inspect(path)), now);
  const others = (await listEntries(ports, paths.extensionsDir))
    .filter((entry) => entry.name !== OMP_EXTENSION_LINK_NAME)
    .map((entry) => ({ name: entry.name, what: describePathState(entry.state) }))
    .sort((a, b) => compare(a.name, b.name));
  return {
    path: paths.extensionsDir,
    dirState,
    link,
    yokiLeftovers: others.filter((entry) => isYokiExtension(entry.name)),
    foreign: others.filter((entry) => !isYokiExtension(entry.name)),
  };
}

async function findYokiLeftovers(
  ports: OmpApplyPorts,
  paths: OmpApplyPaths,
): Promise<readonly OmpLeftover[]> {
  const found: OmpLeftover[] = [];
  for (const { name, note } of YOKI_LEFTOVER_NOTES) {
    const path = `${paths.agentDir}/${name}`;
    const state = await ports.inspect(path);
    if (state.kind === "missing") continue;
    found.push({ name, path, what: describePathState(state), note });
  }
  return found;
}

function needsWrite(report: Omit<OmpApplyReport, "outcome" | "wrote" | "message">): boolean {
  return (
    managedDirChanges(report.agentsSkillsDir) ||
    report.agents.files.some((file) => file.outcome === "write") ||
    report.mcpJson.outcome === "write" ||
    report.extensions.link.state !== "ok"
  );
}

export async function applyOmp(
  input: {
    readonly paths: OmpApplyPaths;
    readonly options: OmpApplyOptions;
    readonly write: boolean;
  },
  ports: OmpApplyPorts,
): Promise<OmpApplyReport> {
  const { paths, options } = input;
  const manifest = { ...(await ports.readManifest()) };
  const now = ports.now();

  const agents = await planAgents(ports, paths, options, manifest, now);
  const mcp = await planMcpJson(ports, paths, manifest);

  const base = {
    agentsSkillsDir: await planAgentsSkillsMount(ports, paths, "omp", now),
    agents,
    mcpJson: mcp.report,
    extensions: await planExtensions(ports, paths, now),
    yokiLeftovers: await findYokiLeftovers(ports, paths),
  };

  const conflicts: string[] = [
    ...agents.files
      .filter((file) => file.outcome === "conflict")
      .map(
        (file) =>
          `agents/${file.name} differs from both jig's last write and the newly generated content`,
      ),
    ...(mcp.report.invalid !== undefined
      ? [
          `mcp.json could not be read as a JSON object (${mcp.report.invalid}); fix it by hand before --write`,
        ]
      : mcp.report.outcome === "conflict"
        ? [
            "mcp.json's jig entries differ from both jig's last write and the newly generated ones (a `/mcp enable|disable` on a jig server counts; use disabledServers instead)",
          ]
        : []),
    ...(base.extensions.dirState.kind === "file"
      ? [`${paths.extensionsDir} is a regular file, not a directory`]
      : []),
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
    for (const file of agents.files) {
      if (file.outcome !== "write") continue;
      if (file.backupPath !== undefined) await ports.rename(file.path, file.backupPath);
      await ports.writeAtomic(file.path, file.content);
      manifest[file.path] = ports.sha256(file.content);
    }
    if (mcp.report.outcome === "write") {
      await ports.writeAtomic(paths.mcpJson, mcp.generated);
      manifest[paths.mcpJson] = ports.sha256(mcp.report.block);
    }
    seedManifest(ports, manifest, base);
    await ports.writeManifest(manifest);
    await ports.writeProvenance(paths.agentDir, {
      sourceFile: paths.mcpServers,
      sourceSha256: ports.sha256((await ports.readFile(paths.mcpServers)) ?? ""),
      generatedAt: now.toISOString(),
      jigVersion: ports.jigVersion,
    });
    await applyManagedDir(ports, base.agentsSkillsDir);
    if (base.extensions.dirState.kind === "missing") await ports.mkdir(paths.extensionsDir);
    await applyLink(ports, base.extensions.link);
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
  ports: OmpApplyPorts,
  manifest: Record<string, string>,
  report: Pick<OmpApplyReport, "agents" | "mcpJson">,
): boolean {
  let added = false;
  const seed = (path: string, content: string) => {
    if (manifest[path] !== undefined) return;
    manifest[path] = ports.sha256(content);
    added = true;
  };
  for (const file of report.agents.files) seed(file.path, file.content);
  seed(report.mcpJson.path, report.mcpJson.block);
  return added;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
