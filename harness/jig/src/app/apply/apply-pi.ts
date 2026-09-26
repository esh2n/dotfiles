/**
 * `jig apply --target pi` — deliver the pi configuration from the sources
 * under `llm/harness/`, and either show what would change (default) or do it
 * (`--write`). Milestone 3c-pi of the generator that retires `yoki-switch`
 * and `core/config/manager.sh`'s `link_pi_resources`; the same shape as
 * `./apply-omp.ts`, over pi's agent directory (`~/.pi/agent`, or
 * `PI_CODING_AGENT_DIR` — `domain/pi/agent-dir.ts`) and the cross-harness
 * skills mount.
 *
 * - `<agentDir>/AGENTS.md` — the same generated content as
 *   `~/.claude/AGENTS.md` and `~/.codex/AGENTS.md`, from the same renderer
 *   (`buildAgentsMd`, `./delivery.ts`). pi reads it from there
 *   (https://pi.dev/docs/latest/configuration, "Agent directory":
 *   "`<agent-dir>/AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`,
 *   or `CLAUDE.MD` — User instructions applied across working
 *   directories"). Today the path is a symlink into the repository
 *   (`home/shared/harness/pi/AGENTS.md`, linked by `link_pi_resources`); per
 *   `rules/decisions/2026-09-22-config-layout-no-personal-layer.md`
 *   (Consequences, 2026-09-24: the generated AGENTS.md is identical for all
 *   five harnesses, pi's short one retires) the link is replaced by the
 *   generated regular file — a symlink is a pointer, so it is `replace`, not
 *   a backup, and the repo file it pointed at is untouched. That file is then
 *   unused; the dry-run says so, and jig does not delete repository files.
 * - `~/.agents/skills/` — the managed directory of links the Codex and omp
 *   targets deliver, planned by the one function all three call
 *   (`planAgentsSkillsMount`). pi reads it natively
 *   (https://pi.dev/docs/latest/skills: "Pi also supports the Agent Skills
 *   locations `~/.agents/skills/` and `.agents/skills/`"), so jig creates no
 *   `<agentDir>/skills/`.
 * - `~/.config/mcp/mcp.json` — jig's entries of `mcpServers` for every
 *   server with `targets.pi` (`domain/pi/mcp.ts`), in pi-mcp-adapter's
 *   user-global shared config; every other entry and top-level key carried
 *   through and named. pi has no MCP client; the MCP-list decision delivers
 *   the list through that extension, which is lazy by default.
 * - Report only: whether `packages` in the repo's `pi/settings.json` (the
 *   source `~/.pi/agent/settings.json` links to) declares pi-mcp-adapter and
 *   tintinweb/pi-subagents (`domain/pi/packages.ts`), with the paste-able
 *   line for each that is missing; `<agentDir>/extensions/` — the links
 *   `link_pi_resources` makes into `home/shared/harness/pi/extensions/` until
 *   milestone 4, and everything else as not jig's; the one gap (no native
 *   subagents — language guidance travels inside the language skills).
 *
 * The invariant is the Claude target's: sources → output, one way. The
 * destination is read to carry through what jig does not own and to say
 * what `--write` would do to what is there. One conflict anywhere stops the
 * whole write.
 */

import type { PathState } from "../../domain/claude/links";
import { describePathState } from "../../domain/claude/managed-dir";
import { parseMcpLayer } from "../../domain/mcp/parse";
import { buildPiMcpServers, planPiMcpJson } from "../../domain/pi/mcp";
import {
  PI_MCP_ADAPTER_NPM,
  PI_SUBAGENTS_NPM,
  findNpmPackage,
  parsePiPackages,
  piInstallLine,
  piPackagesEntry,
} from "../../domain/pi/packages";
import { unifiedDiff } from "../../domain/tiers/diff";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import {
  type AgentsMdReport,
  type AgentsSkillsMountReport,
  applyAgentsMd,
  applyManagedDir,
  buildAgentsMd,
  listEntries,
  managedDirChanges,
  planAgentsMd,
  planAgentsSkillsMount,
  readJson,
} from "./delivery";
import type { PiApplyPorts } from "./ports";

export interface PiApplyPaths {
  /** `llm/harness/`, absolute. `skills/` and `rules/` are under it. */
  readonly harnessRoot: string;
  /** `llm/harness/mcp/servers.json`. */
  readonly mcpServers: string;
  /** `llm/harness/rules/decisions/`. */
  readonly decisions: string;
  /** The trees yoki-switch linked skills from: a link under one of them is stale, not somebody's. */
  readonly formerSkillRoots: readonly string[];
  /** Destination: `~/.agents/skills`, the cross-harness mount, one link per skill. */
  readonly agentsSkills: string;
  /** pi's agent directory: `~/.pi/agent`, or `PI_CODING_AGENT_DIR`. */
  readonly agentDir: string;
  /** Destination: `<agentDir>/AGENTS.md`. */
  readonly agentsMd: string;
  /** Destination: pi-mcp-adapter's user-global shared config, `~/.config/mcp/mcp.json`. */
  readonly mcpJson: string;
  /** `<agentDir>/mcp.json`: the adapter's own override file, reported, never written. */
  readonly adapterOverride: string;
  /** `<agentDir>/extensions/`, reported only. */
  readonly extensionsDir: string;
  /** Source of the extension links `link_pi_resources` makes: `home/shared/harness/pi/extensions`. */
  readonly repoExtensionsDir: string;
  /** Source: `home/shared/harness/pi/settings.json`, the file `<agentDir>/settings.json` links to. */
  readonly repoSettings: string;
  /** The retiring `home/shared/harness/pi/AGENTS.md`, reported as unused once the generated file lands. */
  readonly retiredAgentsMd: string;
  /** Substituted into mcp command paths; `{{HOME}}`. */
  readonly home: string;
}

export type PiOutcome = "write" | "noop" | "conflict";

export interface PiAgentsMdReport extends AgentsMdReport {
  /** Set when a symlink stands at the path: on `--write` the link is removed and the file written; its target is untouched. */
  readonly replacesSymlink?: string;
}

export interface PiMcpJsonReport {
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
  /** `<agentDir>/mcp.json`, the adapter's own override file, as found. */
  readonly adapterOverride: { readonly path: string; readonly state: PathState };
}

/** One package the generator relies on, and whether the source declares it. */
export interface PiPackageReport {
  readonly name: string;
  /** What jig needs it for. */
  readonly role: string;
  /** The declared source when present (`npm:<name>[@version]`). */
  readonly source?: string;
  /** The two paste-able forms when absent. */
  readonly installLine: string;
  readonly packagesEntry: string;
}

export interface PiPackagesReport {
  /** The repo settings file read. */
  readonly path: string;
  /** Set when the file is missing or unreadable; every package then reads as absent. */
  readonly invalid?: string;
  readonly packages: readonly PiPackageReport[];
}

/** `<agentDir>/extensions/`, reported only in this milestone. */
export interface PiExtensionsReport {
  readonly path: string;
  readonly dirState: PathState;
  /** Links into `home/shared/harness/pi/extensions/`: `link_pi_resources`'s until milestone 4. */
  readonly managerLinks: readonly { readonly name: string; readonly target: string }[];
  /** Everything else: not jig's. */
  readonly foreign: readonly { readonly name: string; readonly what: string }[];
}

export interface PiApplyReport {
  /** Over all parts: any conflict wins; then any change; then noop. */
  readonly outcome: PiOutcome;
  /** True when `--write` applied the delivery. Never true with a conflict anywhere. */
  readonly wrote: boolean;
  readonly agentsSkillsDir: AgentsSkillsMountReport;
  readonly agentsMd: PiAgentsMdReport;
  /** The retiring repo file, as found: still present means a source-side cleanup is owed. */
  readonly retiredAgentsMd: { readonly path: string; readonly state: PathState };
  readonly mcpJson: PiMcpJsonReport;
  readonly packages: PiPackagesReport;
  readonly extensions: PiExtensionsReport;
  readonly message?: string;
}

async function planPiAgentsMd(
  ports: PiApplyPorts,
  paths: PiApplyPaths,
  manifest: Readonly<Record<string, string>>,
  now: Date,
): Promise<PiAgentsMdReport> {
  const generated = await buildAgentsMd(ports, paths);
  const state = await ports.inspect(paths.agentsMd);
  const planned = await planAgentsMd(ports, { path: paths.agentsMd, generated, manifest, now });
  if (state.kind !== "symlink") return planned;
  // A link is a pointer, not somebody's file: it is replaced, nothing is
  // backed up, and what it points at (today the repo's own AGENTS.md) stays.
  // The content read through it is not jig's last write, whatever the
  // manifest says, so hand-edit detection does not apply.
  const { backupPath: _dropped, ...rest } = planned;
  return { ...rest, outcome: "write", replacesSymlink: state.target };
}

async function planMcpJson(
  ports: PiApplyPorts,
  paths: PiApplyPaths,
  manifest: Readonly<Record<string, string>>,
): Promise<{ readonly report: PiMcpJsonReport; readonly generated: string }> {
  const read = await readJson(ports, paths.mcpServers);
  if (read === undefined) {
    throw new Error(`jig apply --target pi: MCP source not found at ${paths.mcpServers}`);
  }
  const layer = parseMcpLayer(read.text, paths.mcpServers);
  const entries = buildPiMcpServers(layer.servers, { HOME: paths.home });
  const current = await ports.readFile(paths.mcpJson);
  const plan = planPiMcpJson(current, entries);
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
      adapterOverride: {
        path: paths.adapterOverride,
        state: await ports.inspect(paths.adapterOverride),
      },
    },
  };
}

/** The packages the generator relies on, in the order the dry-run lists them. */
const RELIED_ON_PACKAGES: readonly { readonly name: string; readonly role: string }[] = [
  {
    name: PI_MCP_ADAPTER_NPM,
    role: "reads ~/.config/mcp/mcp.json: without it, the mcp servers above reach nothing (pi has no MCP client)",
  },
  {
    name: PI_SUBAGENTS_NPM,
    role: "runs a Claude Code workflow script unchanged (subagents decision; pi has no native subagents)",
  },
];

async function reportPackages(ports: PiApplyPorts, paths: PiApplyPaths): Promise<PiPackagesReport> {
  const text = await ports.readFile(paths.repoSettings);
  const parsed = parsePiPackages(text);
  const invalid = text === undefined ? `${paths.repoSettings} does not exist` : parsed.invalid;
  return {
    path: paths.repoSettings,
    ...(invalid === undefined ? {} : { invalid }),
    packages: RELIED_ON_PACKAGES.map(({ name, role }) => {
      const source = findNpmPackage(parsed, name);
      return {
        name,
        role,
        ...(source === undefined ? {} : { source }),
        installLine: piInstallLine(name),
        packagesEntry: piPackagesEntry(name),
      };
    }),
  };
}

async function reportExtensions(
  ports: PiApplyPorts,
  paths: PiApplyPaths,
): Promise<PiExtensionsReport> {
  const dirState = await ports.inspect(paths.extensionsDir);
  const entries = [...(await listEntries(ports, paths.extensionsDir))].sort((a, b) =>
    compare(a.name, b.name),
  );
  const managerLinks: { name: string; target: string }[] = [];
  const foreign: { name: string; what: string }[] = [];
  for (const entry of entries) {
    if (
      entry.state.kind === "symlink" &&
      entry.state.target.startsWith(`${paths.repoExtensionsDir}/`)
    ) {
      managerLinks.push({ name: entry.name, target: entry.state.target });
    } else {
      foreign.push({ name: entry.name, what: describePathState(entry.state) });
    }
  }
  return { path: paths.extensionsDir, dirState, managerLinks, foreign };
}

function needsWrite(report: Omit<PiApplyReport, "outcome" | "wrote" | "message">): boolean {
  return (
    managedDirChanges(report.agentsSkillsDir) ||
    report.agentsMd.outcome === "write" ||
    report.mcpJson.outcome === "write"
  );
}

export async function applyPi(
  input: { readonly paths: PiApplyPaths; readonly write: boolean },
  ports: PiApplyPorts,
): Promise<PiApplyReport> {
  const { paths } = input;
  const manifest = { ...(await ports.readManifest()) };
  const now = ports.now();

  const agentsMd = await planPiAgentsMd(ports, paths, manifest, now);
  const mcp = await planMcpJson(ports, paths, manifest);

  const base = {
    agentsSkillsDir: await planAgentsSkillsMount(ports, paths, "pi", now),
    agentsMd,
    retiredAgentsMd: {
      path: paths.retiredAgentsMd,
      state: await ports.inspect(paths.retiredAgentsMd),
    },
    mcpJson: mcp.report,
    packages: await reportPackages(ports, paths),
    extensions: await reportExtensions(ports, paths),
  };

  const conflicts: string[] = [
    ...(agentsMd.outcome === "conflict"
      ? ["AGENTS.md differs from both jig's last write and the newly generated content"]
      : []),
    ...(mcp.report.invalid !== undefined
      ? [
          `${paths.mcpJson} could not be read as a JSON object (${mcp.report.invalid}); fix it by hand before --write`,
        ]
      : mcp.report.outcome === "conflict"
        ? [
            `${paths.mcpJson}'s jig entries differ from both jig's last write and the newly generated ones (a hand edit inside a jig entry counts; a per-project switch-off belongs in .pi/mcp.json, where /mcp disable writes it)`,
          ]
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
    if (agentsMd.outcome === "write") {
      if (agentsMd.replacesSymlink !== undefined) {
        // The link itself, never what it points at.
        await ports.remove(agentsMd.path);
        await ports.writeAtomic(agentsMd.path, agentsMd.content);
        manifest[agentsMd.path] = ports.sha256(agentsMd.content);
      } else {
        await applyAgentsMd(ports, agentsMd, manifest);
      }
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
  ports: PiApplyPorts,
  manifest: Record<string, string>,
  report: Pick<PiApplyReport, "agentsMd" | "mcpJson">,
): boolean {
  let added = false;
  const seed = (path: string, content: string) => {
    if (manifest[path] !== undefined) return;
    manifest[path] = ports.sha256(content);
    added = true;
  };
  seed(report.agentsMd.path, report.agentsMd.content);
  seed(report.mcpJson.path, report.mcpJson.block);
  return added;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
