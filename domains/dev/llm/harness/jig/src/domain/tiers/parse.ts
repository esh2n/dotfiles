/**
 * Strict parser/validator for the canonical tier table (already
 * `JSON.parse`d by the caller — this module never touches IO). Every object
 * shape is closed: an unknown key at any level, a missing tier, a missing
 * required field, or a wrong-typed value all throw with a precise,
 * location-naming message, on the same "fail loud at load time" principle as
 * `../policy/parse.ts`.
 */

import { TIER_IDS, type Tier, type TierId, type TiersPolicy } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(obj: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`tiers policy: ${label} has an unknown key "${key}"`);
    }
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`tiers policy: ${label} must be an object`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`tiers policy: ${label} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`tiers policy: ${label} must be a boolean`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`tiers policy: ${label} must be a number`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`tiers policy: ${label} must be an array of strings`);
  }
  return value as string[];
}

function parseEffortMap(value: unknown, label: string): Record<string, string | null> {
  const obj = requireObject(value, label);
  const result: Record<string, string | null> = {};
  for (const [key, v] of Object.entries(obj)) {
    if (v !== null && typeof v !== "string") {
      throw new Error(`tiers policy: ${label}.${key} must be a string or null`);
    }
    result[key] = v;
  }
  return result;
}

function parseCommentMap(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const obj = requireObject(value, label);
  const result: Record<string, string> = {};
  for (const [key, v] of Object.entries(obj)) {
    result[key] = requireString(v, `${label}.${key}`);
  }
  return result;
}

function parseBackend(value: unknown, label: string): Tier["backend"] {
  const obj = requireObject(value, label);
  assertKnownKeys(obj, ["provider", "model", "apiKeyEnv"], label);
  return {
    provider: requireString(obj.provider, `${label}.provider`),
    model: requireString(obj.model, `${label}.model`),
    ...(obj.apiKeyEnv === undefined
      ? {}
      : { apiKeyEnv: requireString(obj.apiKeyEnv, `${label}.apiKeyEnv`) }),
  };
}

function parseTierCompat(value: unknown, label: string): Tier["compat"] {
  const obj = requireObject(value, label);
  assertKnownKeys(obj, ["thinkingFormat", "supportsReasoningEffort"], label);
  return {
    ...(obj.thinkingFormat === undefined
      ? {}
      : { thinkingFormat: requireString(obj.thinkingFormat, `${label}.thinkingFormat`) }),
    ...(obj.supportsReasoningEffort === undefined
      ? {}
      : {
          supportsReasoningEffort: requireBoolean(
            obj.supportsReasoningEffort,
            `${label}.supportsReasoningEffort`,
          ),
        }),
  };
}

function parseSamplingParams(value: unknown, label: string): Tier["samplingParams"] {
  const obj = requireObject(value, label);
  assertKnownKeys(obj, ["temperature", "top_p", "top_k"], label);
  return {
    temperature: requireNumber(obj.temperature, `${label}.temperature`),
    top_p: requireNumber(obj.top_p, `${label}.top_p`),
    top_k: requireNumber(obj.top_k, `${label}.top_k`),
  };
}

function parseTierPi(value: unknown, label: string): Tier["pi"] {
  const obj = requireObject(value, label);
  assertKnownKeys(obj, ["name"], label);
  return { name: requireString(obj.name, `${label}.name`) };
}

function parseTierDsh(value: unknown, label: string): Tier["dsh"] {
  const obj = requireObject(value, label);
  assertKnownKeys(obj, ["name", "reasoningEfforts", "compat", "_comment"], label);

  let compat: { thinkingFormat?: string } | undefined;
  if (obj.compat !== undefined) {
    const compatObj = requireObject(obj.compat, `${label}.compat`);
    assertKnownKeys(compatObj, ["thinkingFormat"], `${label}.compat`);
    compat = {
      ...(compatObj.thinkingFormat === undefined
        ? {}
        : {
            thinkingFormat: requireString(
              compatObj.thinkingFormat,
              `${label}.compat.thinkingFormat`,
            ),
          }),
    };
  }

  return {
    name: requireString(obj.name, `${label}.name`),
    ...(obj.reasoningEfforts === undefined
      ? {}
      : { reasoningEfforts: parseEffortMap(obj.reasoningEfforts, `${label}.reasoningEfforts`) }),
    ...(compat !== undefined ? { compat } : {}),
    ...(parseCommentMap(obj._comment, `${label}._comment`) !== undefined
      ? { _comment: parseCommentMap(obj._comment, `${label}._comment`) }
      : {}),
  };
}

const TIER_FIELDS = [
  "alias",
  "displayName",
  "backend",
  "reasoning",
  "input",
  "contextWindow",
  "maxTokens",
  "compat",
  "thinkingLevelMap",
  "samplingParams",
  "pi",
  "dsh",
] as const;

function parseTier(raw: unknown, id: TierId): Tier {
  const label = `tier "${id}"`;
  const obj = requireObject(raw, label);
  assertKnownKeys(obj, TIER_FIELDS, label);

  const alias = requireString(obj.alias, `${label}.alias`);
  if (alias !== id) {
    throw new Error(`tiers policy: ${label} alias "${alias}" must equal its tier key "${id}"`);
  }

  return {
    alias,
    displayName: requireString(obj.displayName, `${label}.displayName`),
    backend: parseBackend(obj.backend, `${label}.backend`),
    reasoning: requireBoolean(obj.reasoning, `${label}.reasoning`),
    input: requireStringArray(obj.input, `${label}.input`),
    contextWindow: requireNumber(obj.contextWindow, `${label}.contextWindow`),
    maxTokens: requireNumber(obj.maxTokens, `${label}.maxTokens`),
    compat: parseTierCompat(obj.compat, `${label}.compat`),
    ...(obj.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: parseEffortMap(obj.thinkingLevelMap, `${label}.thinkingLevelMap`) }),
    ...(obj.samplingParams === undefined
      ? {}
      : { samplingParams: parseSamplingParams(obj.samplingParams, `${label}.samplingParams`) }),
    pi: parseTierPi(obj.pi, `${label}.pi`),
    dsh: parseTierDsh(obj.dsh, `${label}.dsh`),
  };
}

function parseProxyConnection(value: unknown): TiersPolicy["connections"]["proxy"] {
  const label = "connections.proxy";
  const obj = requireObject(value, label);
  assertKnownKeys(obj, ["baseUrl", "api", "compat", "_comment", "pi", "dsh"], label);

  const compatObj = requireObject(obj.compat, `${label}.compat`);
  assertKnownKeys(compatObj, ["supportsDeveloperRole", "maxTokensField"], `${label}.compat`);

  const piObj = requireObject(obj.pi, `${label}.pi`);
  assertKnownKeys(piObj, ["apiKey"], `${label}.pi`);

  const dshObj = requireObject(obj.dsh, `${label}.dsh`);
  assertKnownKeys(dshObj, ["displayName", "apiKeyEnv", "_comment"], `${label}.dsh`);

  return {
    baseUrl: requireString(obj.baseUrl, `${label}.baseUrl`),
    api: requireString(obj.api, `${label}.api`),
    compat: {
      supportsDeveloperRole: requireBoolean(
        compatObj.supportsDeveloperRole,
        `${label}.compat.supportsDeveloperRole`,
      ),
      maxTokensField: requireString(compatObj.maxTokensField, `${label}.compat.maxTokensField`),
    },
    ...(parseCommentMap(obj._comment, `${label}._comment`) !== undefined
      ? { _comment: parseCommentMap(obj._comment, `${label}._comment`) }
      : {}),
    pi: { apiKey: requireString(piObj.apiKey, `${label}.pi.apiKey`) },
    dsh: {
      displayName: requireString(dshObj.displayName, `${label}.dsh.displayName`),
      apiKeyEnv: requireString(dshObj.apiKeyEnv, `${label}.dsh.apiKeyEnv`),
      ...(parseCommentMap(dshObj._comment, `${label}.dsh._comment`) !== undefined
        ? { _comment: parseCommentMap(dshObj._comment, `${label}.dsh._comment`) }
        : {}),
    },
  };
}

/** Parse and strictly validate an already-`JSON.parse`d tiers document. */
export function parseTiers(json: unknown): TiersPolicy {
  if (!isPlainObject(json)) {
    throw new Error("tiers policy: expected a JSON object at the top level");
  }

  assertKnownKeys(json, ["version", "connections", "tiers", "_comment"], "document");

  if (json.version !== 1) {
    throw new Error(
      `tiers policy: unsupported version ${JSON.stringify(json.version)} (expected 1)`,
    );
  }

  const connectionsObj = requireObject(json.connections, "connections");
  assertKnownKeys(connectionsObj, ["proxy"], "connections");

  const tiersObj = requireObject(json.tiers, "tiers");
  for (const key of Object.keys(tiersObj)) {
    if (!(TIER_IDS as readonly string[]).includes(key)) {
      throw new Error(`tiers policy: unknown tier "${key}"`);
    }
  }
  for (const id of TIER_IDS) {
    if (!(id in tiersObj)) {
      throw new Error(`tiers policy: missing tier "${id}"`);
    }
  }

  const tiers = Object.fromEntries(
    TIER_IDS.map((id) => [id, parseTier(tiersObj[id], id)]),
  ) as Record<TierId, Tier>;

  return {
    version: 1,
    connections: { proxy: parseProxyConnection(connectionsObj.proxy) },
    tiers,
  };
}
