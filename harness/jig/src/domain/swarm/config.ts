/**
 * The Swarm's limits, from `harness/policy/swarm.json` — a file the owner
 * writes and no agent may (the guard's floor keeps `policy/` owner-only), so
 * a model cannot raise its own spend ceiling (rules/research/
 * 2026-09-22-orchestration-in-the-wild.md: #78019, settings agents could
 * write). Without the file the defaults below apply.
 *
 * `deterministic` defaults to one: the Omarchy llama-server has one slot
 * (rules/decisions/2026-09-27-deterministic-falls-back-to-the-mac.md), and a
 * second request only waits inside it.
 */

import { TIERS, type Tier } from "./types";

export interface SwarmConfig {
  /** Workers of a tier running at once. */
  readonly maxConcurrent: Readonly<Record<Tier, number>>;
  /** Workers one session may start in total (running, queued and finished). */
  readonly maxWorkers: number;
  /** Characters of a worker's final answer delivered inline; the rest stays in its log. */
  readonly resultChars: number;
}

export const DEFAULT_CONFIG: SwarmConfig = {
  maxConcurrent: { main: 8, complex: 4, deterministic: 1 },
  maxWorkers: 32,
  resultChars: 4000,
};

function positiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`swarm config: ${label} must be a positive integer`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses the file's JSON; every key is optional and unknown keys are refused. */
export function parseSwarmConfig(json: unknown): SwarmConfig {
  if (!isPlainObject(json)) throw new Error("swarm config: must be a JSON object");
  for (const key of Object.keys(json)) {
    if (!["maxConcurrent", "maxWorkers", "resultChars", "$comment"].includes(key)) {
      throw new Error(`swarm config: unknown key "${key}"`);
    }
  }
  let maxConcurrent = DEFAULT_CONFIG.maxConcurrent;
  if (json.maxConcurrent !== undefined) {
    const given = json.maxConcurrent;
    if (!isPlainObject(given)) throw new Error("swarm config: maxConcurrent must be an object");
    for (const key of Object.keys(given)) {
      if (!(TIERS as readonly string[]).includes(key)) {
        throw new Error(`swarm config: maxConcurrent has an unknown tier "${key}"`);
      }
    }
    maxConcurrent = Object.fromEntries(
      TIERS.map((tier) => [
        tier,
        given[tier] === undefined
          ? DEFAULT_CONFIG.maxConcurrent[tier]
          : positiveInt(given[tier], `maxConcurrent.${tier}`),
      ]),
    ) as Record<Tier, number>;
  }
  return {
    maxConcurrent,
    maxWorkers:
      json.maxWorkers === undefined
        ? DEFAULT_CONFIG.maxWorkers
        : positiveInt(json.maxWorkers, "maxWorkers"),
    resultChars:
      json.resultChars === undefined
        ? DEFAULT_CONFIG.resultChars
        : positiveInt(json.resultChars, "resultChars"),
  };
}
