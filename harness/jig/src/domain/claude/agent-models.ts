/**
 * `agents/models.json`: the ruled Claude-tier → model table every other
 * harness target reads. One object per target (`codex`, `omp`), each keyed
 * by tier name (`haiku`/`sonnet`/`opus`) with `{ model, reasoningEffort? }`
 * — the `ModelMapping` of `./agent-definition.ts`, so a per-agent override
 * in the frontmatter and a tier entry here are the same shape and the
 * target does not care which it got.
 *
 * An empty target object is a valid file: it means "not ruled yet", and the
 * target leaves `model` out of every generated file and reports the gap per
 * tier. A wrong shape is an error naming the file and the key, never a
 * silent empty map: the generator never invents a model id, and it never
 * quietly drops one either.
 *
 * Pure: text in, a record out. The composition root reads the file.
 */

import type { ModelMapping } from "./agent-definition";

export const AGENT_MODELS_SCHEMA_VERSION = "jig.agent-models.v1";

/** The targets the file may carry a table for. A key outside this set (other than `_comment` and friends) is an error, so a typo cannot pass as "not ruled". */
export const AGENT_MODELS_TARGETS = ["codex", "omp"] as const;

export type AgentModelsTarget = (typeof AGENT_MODELS_TARGETS)[number];

/** Tier name (lower-cased) → mapping, per target. A target absent from the file is `{}`. */
export type AgentModels = Readonly<
  Record<AgentModelsTarget, Readonly<Record<string, ModelMapping>>>
>;

/** What a file with no rulings at all resolves to. */
export const EMPTY_AGENT_MODELS: AgentModels = { codex: {}, omp: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One `{ model, reasoningEffort? }` entry, checked field by field. Keys that
 * start with `_` are comments and pass; any other extra key is an error.
 */
export function parseModelMapping(value: unknown, label: string): ModelMapping {
  if (!isRecord(value)) throw new Error(`${label}: expected an object with a "model" key`);
  const { model, reasoningEffort } = value;
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error(`${label}: "model" must be a non-empty string`);
  }
  if (
    reasoningEffort !== undefined &&
    (typeof reasoningEffort !== "string" || reasoningEffort.trim() === "")
  ) {
    throw new Error(`${label}: "reasoningEffort" must be a non-empty string when present`);
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith("_") || key === "model" || key === "reasoningEffort") continue;
    throw new Error(`${label}: unknown key "${key}" (expected model, reasoningEffort)`);
  }
  return {
    model: model.trim(),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort: reasoningEffort.trim() }),
  };
}

/**
 * @param text raw file content (already read by the caller)
 * @param label used only in error messages (typically the file path)
 */
export function parseAgentModels(text: string, label: string): AgentModels {
  const json: unknown = JSON.parse(text);
  if (!isRecord(json)) throw new Error(`${label}: expected a JSON object`);
  if (json.schemaVersion !== AGENT_MODELS_SCHEMA_VERSION) {
    throw new Error(
      `${label}: unsupported schemaVersion "${String(json.schemaVersion)}" (expected "${AGENT_MODELS_SCHEMA_VERSION}")`,
    );
  }
  for (const key of Object.keys(json)) {
    if (key.startsWith("_") || key === "schemaVersion") continue;
    if (!(AGENT_MODELS_TARGETS as readonly string[]).includes(key)) {
      throw new Error(
        `${label}: unknown target "${key}" (expected ${AGENT_MODELS_TARGETS.join(", ")})`,
      );
    }
  }

  const tables = {} as Record<AgentModelsTarget, Record<string, ModelMapping>>;
  for (const target of AGENT_MODELS_TARGETS) {
    const table = json[target];
    tables[target] = {};
    if (table === undefined) continue;
    if (!isRecord(table)) throw new Error(`${label}: "${target}" must be an object keyed by tier`);
    for (const [tier, entry] of Object.entries(table)) {
      if (tier.startsWith("_")) continue;
      tables[target][tier.toLowerCase()] = parseModelMapping(entry, `${label}: ${target}.${tier}`);
    }
  }
  return tables;
}
