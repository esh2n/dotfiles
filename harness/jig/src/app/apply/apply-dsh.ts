/**
 * `jig apply --target dsh`, the harness-home half — deliver the DSH
 * configuration from the sources under `llm/harness/`, and either show what
 * would change (default) or do it (`--write`). Milestone 3c-dsh of the
 * generator that retires `yoki-switch` and `core/config/manager.sh`'s
 * `link_dsh_resources`; the same shape as `./apply-pi.ts`, over DSH's
 * harness home (`~/.dsh`, or `DSH_HOME` — `domain/dsh/home.ts`). The tiers
 * half (`next/home/shared/harness/dsh/settings.yaml` from `policy/tiers.json`,
 * `./apply-tiers.ts`) runs first under the same target name, as pi's does.
 *
 * - `<dshHome>/profiles/<name>/cordis.patch.yml` — for every profile DSH
 *   has scaffolded there that ALSO has a source
 *   `next/home/shared/harness/dsh/profiles/<name>/cordis.patch.yml` (the rule
 *   `link_dsh_resources` applies, so the two agree on which profiles are
 *   ours): jig's `- insert:` row of `@deepseek-ai/dsh-mcp-client` entries,
 *   one per server with `targets.dsh` (`domain/dsh/mcp.ts`), inside its
 *   own marked block (`domain/dsh/cordis-patch.ts`); every other row is
 *   carried through byte for byte. Manifest-tracked per profile; a hand
 *   edit inside the block, a jig id or server name declared outside it, or
 *   an unterminated block is a conflict. A profile directory is never
 *   created: DSH scaffolds profiles ("pnpm workspaces DSH itself
 *   scaffolds", `rules/research/2026-09-22-generator-migration-map.md`
 *   §6.5), and when none matches nothing at all is delivered.
 * - `<dshHome>/AGENTS.md` — the same generated content as
 *   `~/.claude/AGENTS.md`, from the same renderer (`buildAgentsMd`,
 *   `./delivery.ts`). DSH reads it: "The first request includes ... the
 *   user-global `$DSH_HOME/AGENTS.md` followed by the project chain"
 *   (`@deepseek-ai/dsh-agent-instructions` README, 0.1.5-rc.2; `dshHome`
 *   defaults to "`$DSH_HOME` or `~/.dsh`"), and "`dsh-base` already
 *   includes it with a 65,536-byte budget" over the whole chain, "broader
 *   files are omitted before the most specific file is truncated" — so the
 *   generated file's size is reported against that budget: past it, DSH
 *   drops this file first.
 * - Report only: `~/.agents/skills` — DSH reads it natively
 *   (`@deepseek-ai/dsh-skill-filesystem` README: the `user-agents` root
 *   `<agentsHome>/skills`, `agentsHome` = "`$DSH_AGENTS_HOME` or
 *   `~/.agents`", rank 500, beside `<dshHome>/skills` at rank 400); the
 *   mount itself is the Codex/omp/pi targets' delivery and is not planned
 *   here. `settings.yaml`, `hooks.claude.json`, the jig-guard plugin build
 *   and its `pnpm add link:` per profile — `link_dsh_resources`'s until
 *   milestone 4. The home-level `<dshHome>/cordis.patch.yml` (applied after
 *   every profile's, dsh README "Profiles") — not jig's, never written, but
 *   scanned for a jig id, which would fail boot just the same.
 *
 * The invariant is the Claude target's: sources → output, one way. The
 * destination is read to carry through what jig does not own and to say
 * what `--write` would do to what is there. One conflict anywhere stops the
 * whole write.
 */

import type { PathState } from "../../domain/claude/links";
import {
  type CordisPatchPlan,
  type DeclaredOutside,
  declaredOutsideBlock,
  planCordisPatch,
} from "../../domain/dsh/cordis-patch";
import { DSH_PROFILE_PATCH_FILENAME } from "../../domain/dsh/home";
import { type DshMcpRow, buildDshMcpRows, renderDshMcpBlock } from "../../domain/dsh/mcp";
import { parseMcpLayer } from "../../domain/mcp/parse";
import { unifiedDiff } from "../../domain/tiers/diff";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import {
  type AgentsMdReport,
  applyAgentsMd,
  buildAgentsMd,
  listEntries,
  planAgentsMd,
  readJson,
} from "./delivery";
import type { DshApplyPorts } from "./ports";

/** dsh-base's `maxBytes` for the whole instruction chain (dsh-agent-instructions README). */
export const DSH_INSTRUCTIONS_BUDGET_BYTES = 65_536;

export interface DshApplyPaths {
  /** `llm/harness/`, absolute. */
  readonly harnessRoot: string;
  /** `llm/harness/mcp/servers.json`. */
  readonly mcpServers: string;
  /** `llm/harness/rules/decisions/`. */
  readonly decisions: string;
  /** DSH's harness home: `~/.dsh`, or `DSH_HOME`. */
  readonly dshHome: string;
  /** Which rule chose it, for the dry-run. */
  readonly dshHomeVia: "DSH_HOME" | "default";
  /** `<dshHome>/profiles`, the directory DSH scaffolds profiles into. */
  readonly profilesDir: string;
  /** Source: `next/home/shared/harness/dsh/profiles`, one `<name>/cordis.patch.yml` per profile the repo owns. */
  readonly repoProfilesDir: string;
  /** Destination: `<dshHome>/AGENTS.md`. */
  readonly agentsMd: string;
  /** `<dshHome>/cordis.patch.yml`: the home-level patch layer, reported and scanned, never written. */
  readonly homePatch: string;
  /** `~/.agents/skills` (or `$DSH_AGENTS_HOME/skills`), reported only. */
  readonly agentsSkills: string;
  /** Set when `DSH_AGENTS_HOME` moved the skills root. */
  readonly agentsSkillsVia: "DSH_AGENTS_HOME" | "default";
  /** `<dshHome>/settings.yaml`, reported only (manager.sh's link to the repo file the tiers half writes). */
  readonly settingsYaml: string;
  /** `<dshHome>/hooks.claude.json`, reported only (manager.sh's expanded copy). */
  readonly hooksClaudeJson: string;
  /** `jig/adapters/dsh`, the guard plugin manager.sh builds and links per profile; reported only. */
  readonly pluginDir: string;
  /** Substituted into mcp command paths; `{{HOME}}`. */
  readonly home: string;
}

export type DshOutcome = "write" | "noop" | "conflict";

/** One profile both DSH scaffolded and the repo owns. */
export interface DshProfileReport {
  readonly name: string;
  readonly dir: string;
  /** `<dir>/cordis.patch.yml`. */
  readonly patchPath: string;
  /** The repo's copy manager.sh installs there (expanded), for the "overwritten on its next run" note. */
  readonly sourcePatch: string;
  readonly outcome: PlanAction;
  readonly diff: string;
  /** What stood at the path before: absent, or a regular file, or something else. */
  readonly state: PathState;
  /** The scaffold's lone `[]` gives way to the block. */
  readonly replacesEmptyLayer: boolean;
  /** Set when the file has a begin marker and no end marker: a conflict. */
  readonly invalid?: string;
  /** jig ids or server names declared outside the block: each a conflict. */
  readonly declaredOutside: readonly DeclaredOutside[];
  /** `<dir>/node_modules/@esh2n/jig-dsh-guard`: whether manager.sh's `pnpm add link:` landed. Report only. */
  readonly guardPlugin: PathState;
}

export interface DshMcpReport {
  /** jig's rows, in source order. */
  readonly rows: readonly DshMcpRow[];
  /** The block as generated, markers included (empty when there are no rows). */
  readonly block: string;
}

export interface DshHomePatchReport {
  readonly path: string;
  readonly state: PathState;
  /** A jig id or server name declared in the home-level layer: a conflict, as in a profile. */
  readonly declaredOutside: readonly DeclaredOutside[];
}

/** Report only: a path manager.sh delivers until milestone 4, as found. */
export interface DshReportedPath {
  readonly path: string;
  readonly state: PathState;
}

export interface DshApplyReport {
  /** Over all parts: any conflict wins; then any change; then noop. */
  readonly outcome: DshOutcome;
  /** True when `--write` applied the delivery. Never true with a conflict anywhere, nor when DSH is not scaffolded. */
  readonly wrote: boolean;
  /** At least one profile is both scaffolded and the repo's. False: nothing is delivered. */
  readonly scaffolded: boolean;
  readonly profilesDir: { readonly path: string; readonly state: PathState };
  readonly profiles: readonly DshProfileReport[];
  /** Repo profiles DSH has not scaffolded on this machine: nothing is delivered there. */
  readonly notScaffolded: readonly string[];
  /** Scaffolded profile directories the repo does not own: not jig's. */
  readonly foreignProfiles: readonly string[];
  readonly mcp: DshMcpReport;
  /** Absent when DSH is not scaffolded: the file would create the home, and nothing is delivered then. */
  readonly agentsMd?: AgentsMdReport;
  readonly homePatch: DshHomePatchReport;
  readonly agentsSkills: DshReportedPath;
  readonly settingsYaml: DshReportedPath;
  readonly hooksClaudeJson: DshReportedPath;
  readonly message?: string;
}

async function loadRows(ports: DshApplyPorts, paths: DshApplyPaths): Promise<DshMcpReport> {
  const read = await readJson(ports, paths.mcpServers);
  if (read === undefined) {
    throw new Error(`jig apply --target dsh: MCP source not found at ${paths.mcpServers}`);
  }
  const layer = parseMcpLayer(read.text, paths.mcpServers);
  const rows = buildDshMcpRows(layer.servers, { HOME: paths.home });
  return { rows, block: renderDshMcpBlock(rows) };
}

/** The repo's profile names, in name order: every directory holding a `cordis.patch.yml`. */
async function repoProfiles(
  ports: DshApplyPorts,
  paths: DshApplyPaths,
): Promise<readonly string[]> {
  const names: string[] = [];
  for (const entry of await listEntries(ports, paths.repoProfilesDir)) {
    if (entry.state.kind !== "dir" && entry.state.kind !== "symlink") continue;
    const patch = await ports.inspect(
      `${paths.repoProfilesDir}/${entry.name}/${DSH_PROFILE_PATCH_FILENAME}`,
    );
    if (patch.kind === "file") names.push(entry.name);
  }
  return names.sort(compare);
}

/** Scaffolded profile directories, in name order; `node_modules` is DSH's shared module fallback, not a profile. */
async function scaffoldedProfiles(
  ports: DshApplyPorts,
  paths: DshApplyPaths,
): Promise<readonly string[]> {
  const names: string[] = [];
  for (const entry of await listEntries(ports, paths.profilesDir)) {
    if (entry.name === "node_modules") continue;
    if (entry.state.kind === "dir" || entry.state.kind === "symlink") names.push(entry.name);
  }
  return names.sort(compare);
}

async function planProfile(
  ports: DshApplyPorts,
  paths: DshApplyPaths,
  name: string,
  mcp: DshMcpReport,
  manifest: Readonly<Record<string, string>>,
): Promise<{ readonly report: DshProfileReport; readonly plan: CordisPatchPlan }> {
  const dir = `${paths.profilesDir}/${name}`;
  const patchPath = `${dir}/${DSH_PROFILE_PATCH_FILENAME}`;
  const state = await ports.inspect(patchPath);
  const current = await ports.readFile(patchPath);
  const plan = planCordisPatch(current, mcp.block);
  const declaredOutside = current === undefined ? [] : declaredOutsideBlock(current, mcp.rows);
  const blockPlan =
    plan.invalid === undefined
      ? planApply({
          currentContent: plan.currentBlock,
          generatedContent: mcp.block,
          manifestHash: manifest[patchPath],
          sha256: ports.sha256,
        })
      : { action: "conflict" as const };
  // The block plan says whether jig's rows changed; the file plan says
  // whether the file would. A missing file with no rows to add is a noop,
  // not a write of nothing.
  const outcome: PlanAction =
    blockPlan.action === "conflict" || declaredOutside.length > 0
      ? "conflict"
      : blockPlan.action === "write" && plan.changed
        ? "write"
        : "noop";
  return {
    plan,
    report: {
      name,
      dir,
      patchPath,
      sourcePatch: `${paths.repoProfilesDir}/${name}/${DSH_PROFILE_PATCH_FILENAME}`,
      outcome,
      diff: unifiedDiff(patchPath, current ?? "", "generated", plan.text),
      state,
      replacesEmptyLayer: plan.replacesEmptyLayer,
      ...(plan.invalid === undefined ? {} : { invalid: plan.invalid }),
      declaredOutside,
      guardPlugin: await ports.inspect(`${dir}/node_modules/@esh2n/jig-dsh-guard`),
    },
  };
}

async function reportHomePatch(
  ports: DshApplyPorts,
  paths: DshApplyPaths,
  rows: readonly DshMcpRow[],
): Promise<DshHomePatchReport> {
  const state = await ports.inspect(paths.homePatch);
  const text = state.kind === "file" ? await ports.readFile(paths.homePatch) : undefined;
  return {
    path: paths.homePatch,
    state,
    declaredOutside: text === undefined ? [] : declaredOutsideBlock(text, rows),
  };
}

async function reported(ports: DshApplyPorts, path: string): Promise<DshReportedPath> {
  return { path, state: await ports.inspect(path) };
}

export async function applyDsh(
  input: { readonly paths: DshApplyPaths; readonly write: boolean },
  ports: DshApplyPorts,
): Promise<DshApplyReport> {
  const { paths } = input;
  const manifest = { ...(await ports.readManifest()) };
  const now = ports.now();

  const mcp = await loadRows(ports, paths);
  const owned = await repoProfiles(ports, paths);
  const profilesDirState = await ports.inspect(paths.profilesDir);
  const present = profilesDirState.kind === "dir" ? await scaffoldedProfiles(ports, paths) : [];
  const matching = owned.filter((name) => present.includes(name));
  const scaffolded = matching.length > 0;

  const planned: { readonly report: DshProfileReport; readonly plan: CordisPatchPlan }[] = [];
  for (const name of matching) planned.push(await planProfile(ports, paths, name, mcp, manifest));

  const agentsMd = scaffolded
    ? await planAgentsMd(ports, {
        path: paths.agentsMd,
        generated: await buildAgentsMd(ports, paths),
        manifest,
        now,
      })
    : undefined;

  const base = {
    scaffolded,
    profilesDir: { path: paths.profilesDir, state: profilesDirState },
    profiles: planned.map((entry) => entry.report),
    notScaffolded: owned.filter((name) => !present.includes(name)),
    foreignProfiles: present.filter((name) => !owned.includes(name)),
    mcp,
    ...(agentsMd === undefined ? {} : { agentsMd }),
    homePatch: await reportHomePatch(ports, paths, mcp.rows),
    agentsSkills: await reported(ports, paths.agentsSkills),
    settingsYaml: await reported(ports, paths.settingsYaml),
    hooksClaudeJson: await reported(ports, paths.hooksClaudeJson),
  };

  if (!scaffolded) {
    return {
      ...base,
      outcome: "noop",
      wrote: false,
      message: `DSH not scaffolded: no profile under ${paths.profilesDir} matches a repo profile (${owned.length === 0 ? "none in the repo" : owned.join(", ")}); nothing is delivered, and jig never creates a profile directory`,
    };
  }

  const conflicts: string[] = [];
  for (const { report } of planned) {
    if (report.invalid !== undefined) {
      conflicts.push(`${report.patchPath}: ${report.invalid}; fix it by hand before --write`);
    } else if (report.declaredOutside.length > 0) {
      conflicts.push(
        `${report.patchPath} already declares ${report.declaredOutside.map((d) => `${d.kind} ${d.value} (line ${d.line})`).join(", ")} outside jig's block — a duplicate fails DSH's boot, so remove the hand-written row or drop the server from mcp/servers.json`,
      );
    } else if (report.outcome === "conflict") {
      conflicts.push(
        `${report.patchPath}'s jig block differs from both jig's last write and the newly generated one (a hand edit inside the block counts)`,
      );
    }
  }
  if (base.homePatch.declaredOutside.length > 0) {
    conflicts.push(
      `${paths.homePatch} (the home-level layer, applied after every profile's) declares ${base.homePatch.declaredOutside.map((d) => `${d.kind} ${d.value} (line ${d.line})`).join(", ")} — a duplicate fails DSH's boot`,
    );
  }
  if (agentsMd?.outcome === "conflict") {
    conflicts.push("AGENTS.md differs from both jig's last write and the newly generated content");
  }
  if (conflicts.length > 0) {
    return {
      ...base,
      outcome: "conflict",
      wrote: false,
      message: `conflict: ${conflicts.join("; ")} — reconcile before --write`,
    };
  }

  const changes =
    planned.some(({ report }) => report.outcome === "write") || agentsMd?.outcome === "write";
  if (input.write && changes) {
    for (const { report, plan } of planned) {
      if (report.outcome !== "write") continue;
      await ports.writeAtomic(report.patchPath, plan.text);
      manifest[report.patchPath] = ports.sha256(mcp.block);
    }
    if (agentsMd?.outcome === "write") await applyAgentsMd(ports, agentsMd, manifest);
    seedManifest(ports, manifest, base);
    await ports.writeManifest(manifest);
    await ports.writeProvenance(paths.dshHome, {
      sourceFile: paths.mcpServers,
      sourceSha256: ports.sha256((await ports.readFile(paths.mcpServers)) ?? ""),
      generatedAt: now.toISOString(),
      jigVersion: ports.jigVersion,
    });
    return { ...base, outcome: "write", wrote: true };
  }

  if (input.write && !changes && seedManifest(ports, manifest, base)) {
    // Nothing to deliver, but the generated content was already current:
    // seed the hashes so a LATER hand edit is detected as one.
    await ports.writeManifest(manifest);
  }

  return { ...base, outcome: changes ? "write" : "noop", wrote: false };
}

/** Record every generated file's hash that is not recorded yet. True when anything was added. */
function seedManifest(
  ports: DshApplyPorts,
  manifest: Record<string, string>,
  report: Pick<DshApplyReport, "profiles" | "mcp" | "agentsMd">,
): boolean {
  let added = false;
  const seed = (path: string, content: string) => {
    if (manifest[path] !== undefined) return;
    manifest[path] = ports.sha256(content);
    added = true;
  };
  // A profile whose file already holds exactly the block is seeded; one
  // with no block yet is not — there is nothing of jig's there to guard.
  for (const profile of report.profiles) {
    if (profile.outcome === "noop" && report.mcp.block !== "" && profile.state.kind === "file") {
      seed(profile.patchPath, report.mcp.block);
    }
  }
  if (report.agentsMd !== undefined) seed(report.agentsMd.path, report.agentsMd.content);
  return added;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
