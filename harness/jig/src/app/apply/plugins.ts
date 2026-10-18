/**
 * External skill packs at apply time: read `harness/plugins/<name>/source.json`,
 * find each pack's checkout under the plugins directory (`dotctl setup
 * plugins` fetches it), and hand the skills and agents directories to the
 * managed-directory plans beside the house's own
 * (`rules/decisions/2026-10-18-pstack-shared-skills.md`).
 *
 * A pack follows its upstream branch, so what it ships is third-party
 * content that changes without review. Three things are therefore never
 * linked from a pack: an entry that is itself a symlink (it could point
 * anywhere on the machine), a skill or agent whose frontmatter declares
 * `hooks` or `mcpServers` (Claude Code would register them), and anything
 * from a pack whose source.json does not parse (named in the report; the
 * rest of the apply goes on).
 *
 * A pack whose checkout is missing contributes nothing. Every link into the
 * plugins directory that is no longer planned is stale, so a pack removed
 * from the repository leaves nothing behind. jig itself never reaches the
 * network.
 */

import { type AgentCandidate, selectAgentFiles } from "../../domain/claude/agents-dir";
import type { ManagedSelection } from "../../domain/claude/managed-dir";
import { type SkillCandidate, selectSkillDirs } from "../../domain/claude/skills-dir";
import { type SourceSelection, mergeSelections } from "../../domain/plugins/merge";
import {
  type PluginSource,
  parsePluginSource,
  riskyFrontmatterKeys,
  untranslated,
} from "../../domain/plugins/plugin-source";
import { listEntries, listSkillCandidates } from "./delivery";
import type { ClaudeApplyPorts } from "./ports";

export interface PluginCheckout {
  readonly name: string;
  /** `<plugins dir>/<name>`. */
  readonly dir: string;
  /** Absent when source.json did not parse; `invalid` says why. */
  readonly source?: PluginSource;
  readonly invalid?: string;
  /** Whether the checkout's skills directory is there. */
  readonly present: boolean;
  readonly skillsDir?: string;
  readonly agentsDir?: string;
  /** Adapter names the house translation does not cover yet; empty without an adapter. */
  readonly untranslated: readonly string[];
}

export interface Plugins {
  /** The plugins directory; absent when none was given. */
  readonly dir?: string;
  readonly packs: readonly PluginCheckout[];
}

function byName<T extends { readonly name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** The packs the repository names, sorted by name; none when `pluginsDir` is absent. */
export async function loadPlugins(
  ports: ClaudeApplyPorts,
  harnessRoot: string,
  pluginsDir: string | undefined,
): Promise<Plugins> {
  if (pluginsDir === undefined) return { packs: [] };
  const root = `${harnessRoot}/plugins`;
  const packs: PluginCheckout[] = [];
  for (const entry of [...(await listEntries(ports, root))].sort(byName)) {
    if (entry.state.kind !== "dir") continue;
    const text = await ports.readFile(`${root}/${entry.name}/source.json`);
    if (text === undefined) continue;
    const dir = `${pluginsDir}/${entry.name}`;
    let source: PluginSource;
    try {
      source = parsePluginSource(entry.name, text);
    } catch (error) {
      const invalid = error instanceof Error ? error.message : String(error);
      packs.push({ name: entry.name, dir, invalid, present: false, untranslated: [] });
      continue;
    }
    const skillsDir = `${dir}/${source.skills}`;
    const present = (await ports.inspect(skillsDir)).kind === "dir";
    const adapterPath = source.adapter === undefined ? undefined : `${dir}/${source.adapter}`;
    const adapter =
      present && adapterPath !== undefined && (await ports.inspect(adapterPath)).kind === "file"
        ? await ports.readFile(adapterPath)
        : undefined;
    packs.push({
      name: source.name,
      dir,
      source,
      present,
      skillsDir,
      ...(source.agents === undefined ? {} : { agentsDir: `${dir}/${source.agents}` }),
      untranslated: adapter === undefined ? [] : untranslated(adapter, source.translated),
    });
  }
  return { dir: pluginsDir, packs };
}

/** A managed directory's plan inputs when it is fed from the house and the packs. */
export interface SourcedPlan {
  readonly selection: ManagedSelection;
  readonly targetOf: (name: string) => string;
  /** The plugins directory: a link into it that is no longer planned is stale. */
  readonly otherSourceDirs: readonly string[];
}

function sourcedPlan(sources: readonly SourceSelection[], plugins: Plugins): SourcedPlan {
  const merged = mergeSelections(sources);
  return {
    selection: merged.selection,
    targetOf: (name) => `${merged.dirOf.get(name) ?? sources[0]?.dir ?? ""}/${name}`,
    otherSourceDirs: plugins.dir === undefined ? [] : [plugins.dir],
  };
}

/** A pack's entries that are symlinks: never linked, whatever they hold. */
const SYMLINK_REASON = "a symlink; a pack's entries must be its own files";

function splitSymlinks<
  T extends { readonly name: string; readonly state: { readonly kind: string } },
>(
  candidates: readonly T[],
): { readonly own: readonly T[]; readonly links: readonly { name: string; reason: string }[] } {
  return {
    own: candidates.filter((c) => c.state.kind !== "symlink"),
    links: candidates
      .filter((c) => c.state.kind === "symlink")
      .map((c) => ({ name: c.name, reason: SYMLINK_REASON })),
  };
}

/** A pack's selection without the files whose frontmatter declares hooks or MCP servers. */
async function withoutRiskyDefinitions(
  ports: ClaudeApplyPorts,
  selection: ManagedSelection,
  symlinks: readonly { name: string; reason: string }[],
  definitionOf: (name: string) => string,
): Promise<ManagedSelection> {
  const linked: string[] = [];
  const excluded = [...selection.excluded, ...symlinks];
  for (const name of selection.linked) {
    const risky = riskyFrontmatterKeys((await ports.readFile(definitionOf(name))) ?? "");
    if (risky.length > 0) {
      excluded.push({
        name,
        reason: `declares ${risky.join(" and ")} in its frontmatter; a pack may not register them`,
      });
      continue;
    }
    linked.push(name);
  }
  return { linked, excluded };
}

/** Skill directories: the house's `skills/` first, then each present pack's. */
export async function skillPlan(
  ports: ClaudeApplyPorts,
  houseDir: string,
  plugins: Plugins,
): Promise<SourcedPlan> {
  const sources: SourceSelection[] = [
    {
      label: "house",
      dir: houseDir,
      selection: selectSkillDirs(await listSkillCandidates(ports, houseDir)),
    },
  ];
  for (const pack of plugins.packs) {
    if (!pack.present || pack.skillsDir === undefined) continue;
    const dir = pack.skillsDir;
    const { own, links } = splitSymlinks<SkillCandidate>(await listSkillCandidates(ports, dir));
    sources.push({
      label: pack.name,
      dir,
      selection: await withoutRiskyDefinitions(
        ports,
        selectSkillDirs(own),
        links,
        (name) => `${dir}/${name}/SKILL.md`,
      ),
    });
  }
  return sourcedPlan(sources, plugins);
}

/** Agent files: the house's `agents/` first, then each present pack's. */
export async function agentPlan(
  ports: ClaudeApplyPorts,
  houseDir: string,
  plugins: Plugins,
): Promise<SourcedPlan> {
  const candidatesOf = async (dir: string): Promise<readonly AgentCandidate[]> =>
    listEntries(ports, dir);
  const sources: SourceSelection[] = [
    { label: "house", dir: houseDir, selection: selectAgentFiles(await candidatesOf(houseDir)) },
  ];
  for (const pack of plugins.packs) {
    if (!pack.present || pack.agentsDir === undefined) continue;
    const dir = pack.agentsDir;
    const { own, links } = splitSymlinks(await candidatesOf(dir));
    sources.push({
      label: pack.name,
      dir,
      selection: await withoutRiskyDefinitions(
        ports,
        selectAgentFiles(own),
        links,
        (name) => `${dir}/${name}`,
      ),
    });
  }
  return sourcedPlan(sources, plugins);
}
