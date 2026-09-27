/**
 * Building one parent session's Swarm from the real machine: the owner's
 * limits (`harness/policy/swarm.json`), the tier → model names
 * (`harness/policy/tiers.json`), the worker command for this harness, the
 * log directory, and the record of worktrees earlier Swarms made here. The pi
 * and omp adapters call this and add only their tool and widget glue.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessCommand } from "../../app/swarm/ports";
import { Swarm, type SwarmDeps } from "../../app/swarm/swarm";
import { type WorktreeDeps, repoRoot } from "../../app/swarm/worktree";
import { DEFAULT_CONFIG, type SwarmConfig, parseSwarmConfig } from "../../domain/swarm/config";
import { decodeWorkerLine } from "../../domain/swarm/decode";
import { TIERS, type Tier } from "../../domain/swarm/types";
import { runCommand } from "../proc/exec-file";
import { nodeWorktreeFs } from "./fs";
import { fileSwarmLog, swarmStateDir } from "./log";
import { spawnWorker } from "./spawn";

export type HarnessName = "pi" | "omp";

/** Set in every worker's environment: a worker never registers `swarm` (no nesting). */
export const WORKER_ENV = "JIG_SWARM_WORKER";

/** harness/ — four levels up from this file (harness/jig/src/infra/swarm/). */
const HARNESS_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadSwarmConfig(root = HARNESS_ROOT): SwarmConfig {
  const json = readJson(join(root, "policy", "swarm.json"));
  return json === undefined ? DEFAULT_CONFIG : parseSwarmConfig(json);
}

/** tier → the first catalog id it uses (`deepseek-flash`), for the MODEL column. */
export function loadModelLabels(root = HARNESS_ROOT): Partial<Record<Tier, string>> {
  const json = readJson(join(root, "policy", "tiers.json")) as
    | { tiers?: Record<string, { use?: unknown }> }
    | undefined;
  const out: Partial<Record<Tier, string>> = {};
  for (const tier of TIERS) {
    const use = json?.tiers?.[tier]?.use;
    if (Array.isArray(use) && typeof use[0] === "string") out[tier] = use[0];
  }
  return out;
}

/**
 * How a worker is started on each harness (pi docs/cli.md, omp
 * docs/cli-reference.md): one-shot JSON mode, no session file, the tier's
 * proxy model, the effort as `--thinking`. The tier variable keeps the
 * worker's tier router on the same tier; the worker variable keeps it from
 * registering `swarm` itself.
 */
export function harnessCommand(harness: HarnessName): HarnessCommand {
  const thinking = (effort?: string) => (effort === undefined ? [] : ["--thinking", effort]);
  if (harness === "pi") {
    return {
      bin: "pi",
      args: ({ task, tier, effort }) => [
        "--mode",
        "json",
        "--no-session",
        "--model",
        `proxy/${tier}`,
        ...thinking(effort),
        task,
      ],
      env: (tier) => ({ [WORKER_ENV]: "1", PI_TIER: tier }),
    };
  }
  return {
    bin: "omp",
    args: ({ task, tier, effort }) => [
      "-p",
      "--mode",
      "json",
      "--no-session",
      "--no-title",
      "--model",
      `proxy/${tier}`,
      ...thinking(effort),
      task,
    ],
    env: (tier) => ({ [WORKER_ENV]: "1", OMP_TIER: tier }),
  };
}

/** Worktrees the Swarm made, per checkout, so a later session can clean up only its own. */
function worktreeRecordPath(env: NodeJS.ProcessEnv): string {
  return join(dirname(swarmStateDir(env, "x")), "worktrees.json");
}

function readWorktreeRecord(env: NodeJS.ProcessEnv): Record<string, string[]> {
  const json = readJson(worktreeRecordPath(env));
  return typeof json === "object" && json !== null ? (json as Record<string, string[]>) : {};
}

export function saveWorktreeRecord(
  env: NodeJS.ProcessEnv,
  root: string,
  names: readonly string[],
): void {
  const record = readWorktreeRecord(env);
  record[root] = [...names];
  const path = worktreeRecordPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

export interface SwarmSessionOptions {
  readonly harness: HarnessName;
  readonly cwd: string;
  readonly sessionId: string;
  readonly env: NodeJS.ProcessEnv;
  readonly onChange: SwarmDeps["onChange"];
  readonly onDeliver: SwarmDeps["onDeliver"];
}

export async function createSwarmSession(options: SwarmSessionOptions): Promise<Swarm> {
  const worktree: WorktreeDeps = { run: runCommand, fs: nodeWorktreeFs };
  const root = await repoRoot(worktree, options.cwd).catch(() => options.cwd);
  const labels = loadModelLabels();
  return new Swarm({
    config: loadSwarmConfig(),
    harness: harnessCommand(options.harness),
    decode: decodeWorkerLine,
    spawn: spawnWorker,
    worktree,
    log: fileSwarmLog(swarmStateDir(options.env, options.sessionId)),
    now: () => Date.now(),
    root,
    ownWorktrees: readWorktreeRecord(options.env)[root] ?? [],
    modelLabel: (tier) => labels[tier],
    onChange: options.onChange,
    onDeliver: options.onDeliver,
    onWorktrees: (names) => saveWorktreeRecord(options.env, root, names),
  });
}
