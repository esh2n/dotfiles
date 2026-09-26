/**
 * `jig setup` — the harness steps that are commands, not files. Activation
 * runs it once the links are written (`home/shared/harness/default.nix`):
 *
 *   1. build jig's DSH plugin, give DSH its expanded copies
 *      (`<dshHome>/hooks.claude.json`; each scaffolded profile's
 *      `cordis.patch.yml`) and link the plugin into each profile with pnpm
 *   2. seed codex's `config.toml` once from `config.toml.default` — it then
 *      holds machine-local trust and hook state, so it is never overwritten
 *   3. `jig apply --target <h> --write` for every harness, then
 *      `jig codex register --write` when codex is installed
 *
 * `jig setup --target <h>` does only what belongs to that harness.
 *
 * The copies land before `apply --target dsh` writes its block into them.
 * A missing tool or a failed step is a warning, never a failure: activation
 * must finish.
 */

import { expandPlaceholders } from "../../domain/setup/expand";

export interface SetupPaths {
  /** The checkout, absolute. */
  readonly root: string;
  /** `~/.dsh`, or `DSH_HOME`. */
  readonly dshHome: string;
  readonly home: string;
  readonly user: string;
}

export interface SetupPorts {
  /** undefined when the file is not there; any other failure throws. */
  readText(path: string): Promise<string | undefined>;
  /** Creates the parent directory; replaces the file whole. */
  writeText(path: string, text: string): Promise<void>;
  isDir(path: string): Promise<boolean>;
  /** Names of the directories directly under `path`; empty when it is absent. */
  listDirs(path: string): Promise<readonly string[]>;
  have(bin: string): Promise<boolean>;
  /** Exit code of `bin args` run in `cwd`. */
  run(bin: string, args: readonly string[], cwd: string): Promise<number>;
  /** Exit code of this jig run with `argv`. */
  jig(argv: readonly string[]): Promise<number>;
  warn(message: string): void;
}

export const SETUP_TARGETS = ["claude", "codex", "pi", "omp", "dsh"] as const;
export type SetupTarget = (typeof SETUP_TARGETS)[number];

export function isSetupTarget(value: string): value is SetupTarget {
  return (SETUP_TARGETS as readonly string[]).includes(value);
}

/**
 * Every harness by default; `targets` narrows it (a sandbox kit sets up the
 * one harness it runs). Each step belongs to its harness: DSH's copies and
 * plugin to dsh, the config seed and the hook registration to codex.
 */
export async function setupHarness(
  paths: SetupPaths,
  ports: SetupPorts,
  targets: readonly SetupTarget[] = SETUP_TARGETS,
): Promise<number> {
  if (targets.includes("dsh")) await step(ports, "DSH", () => setupDsh(paths, ports));
  if (targets.includes("codex")) {
    await step(ports, "codex's config.toml", () => seedCodexConfig(paths.root, ports));
  }
  for (const target of targets) {
    if ((await ports.jig(["apply", "--target", target, "--write"])) !== 0) {
      ports.warn(`jig apply --target ${target} failed`);
    }
  }
  if (targets.includes("codex") && (await ports.have("codex"))) {
    if ((await ports.jig(["codex", "register", "--write"])) !== 0) {
      ports.warn("jig codex register failed");
    }
  }
  return 0;
}

/** Runs one step; a failure is a warning, and the next step still runs. */
async function step(ports: SetupPorts, what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    ports.warn(`${what}: ${(error as Error).message}`);
  }
}

async function setupDsh(paths: SetupPaths, ports: SetupPorts): Promise<void> {
  const source = `${paths.root}/home/shared/harness/dsh`;
  const plugin = `${paths.root}/harness/jig/adapters/dsh`;
  const pluginBuilt = await buildPlugin(`${paths.root}/harness/jig`, plugin, ports);
  const canLink = pluginBuilt && (await ports.have("pnpm"));
  const vars = { home: paths.home, user: paths.user, dotfilesRoot: paths.root };
  const install = async (from: string, to: string): Promise<void> => {
    const text = await ports.readText(from);
    if (text !== undefined) await ports.writeText(to, expandPlaceholders(text, vars));
  };

  await install(`${source}/hooks.claude.json`, `${paths.dshHome}/hooks.claude.json`);
  for (const profile of await ports.listDirs(`${source}/profiles`)) {
    const profileHome = `${paths.dshHome}/profiles/${profile}`;
    // DSH scaffolds its profiles; one not scaffolded on this machine is not ours to create.
    if (!(await ports.isDir(profileHome))) continue;
    await install(
      `${source}/profiles/${profile}/cordis.patch.yml`,
      `${profileHome}/cordis.patch.yml`,
    );
    if (canLink && (await ports.run("pnpm", ["add", `link:${plugin}`], profileHome)) !== 0) {
      ports.warn(`could not link the jig plugin into DSH profile ${profile}`);
    }
  }
}

// The plugin bundles jig's own source, so jig's dependencies must be there
// first: bun fetches missing packages when it runs a script, not when it
// bundles one.
async function buildPlugin(jig: string, plugin: string, ports: SetupPorts): Promise<boolean> {
  if ((await ports.readText(`${plugin}/src/index.ts`)) === undefined) return false;
  if (
    (await ports.have("bun")) &&
    (await ports.run("bun", ["install", "--frozen-lockfile"], jig)) === 0 &&
    (await ports.run("bun", ["run", "build"], plugin)) === 0
  ) {
    return true;
  }
  ports.warn(
    "jig DSH plugin not built (bun missing or build failed); profiles will not compose jig-guard",
  );
  return false;
}

async function seedCodexConfig(root: string, ports: SetupPorts): Promise<void> {
  const dir = `${root}/home/shared/harness/codex`;
  if ((await ports.readText(`${dir}/config.toml`)) !== undefined) return;
  const seed = await ports.readText(`${dir}/config.toml.default`);
  if (seed !== undefined) await ports.writeText(`${dir}/config.toml`, seed);
}
