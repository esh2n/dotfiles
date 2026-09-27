/**
 * The model catalog — `harness/policy/models.json`: every model a tier may
 * be pointed at, each as one LiteLLM deployment. `tiers.json` names catalog
 * ids per tier (`use`), so pointing `main` at another model is a change to
 * one field, and a new model is one new catalog entry
 * (rules/decisions/2026-09-27-model-catalog-and-tier-assignment.md).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(obj: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`models catalog: ${label} has an unknown key "${key}"`);
    }
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`models catalog: ${label} must be an object`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`models catalog: ${label} must be a non-empty string`);
  }
  return value;
}

/** One model, as LiteLLM reaches it. */
export interface CatalogModel {
  readonly id: string;
  /** LiteLLM's provider prefix (`deepseek`, `openai`, `lm_studio`, …). */
  readonly provider: string;
  /** The model id the provider knows. */
  readonly model: string;
  /** Env var holding the API base, when it is not the provider's default. */
  readonly apiBaseEnv?: string;
  /** Env var LiteLLM reads the key from; litellm-up.sh fills it from `keyRef`. */
  readonly apiKeyEnv?: string;
  /** Where the key is (an `op://` reference), read at LiteLLM's launch. */
  readonly keyRef?: string;
  /** Extra `litellm_params` for this deployment (e.g. `extra_body`). */
  readonly litellmParams?: Readonly<Record<string, unknown>>;
  /** LiteLLM's `model_info` for this deployment (cooldown, prices, health checks). */
  readonly modelInfo?: Readonly<Record<string, unknown>>;
  /** Why this entry looks the way it does — rendered as a comment above it. */
  readonly notes?: string;
}

export interface ModelCatalog {
  readonly version: 1;
  readonly models: Readonly<Record<string, CatalogModel>>;
}

const MODEL_FIELDS = [
  "provider",
  "model",
  "apiBaseEnv",
  "apiKeyEnv",
  "keyRef",
  "litellmParams",
  "modelInfo",
  "notes",
] as const;

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const CATALOG_ID = /^[a-z0-9][a-z0-9._-]*$/;

function optionalEnv(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const name = requireString(value, label);
  if (!ENV_NAME.test(name)) {
    throw new Error(`models catalog: ${label} "${name}" is not an environment variable name`);
  }
  return name;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return requireObject(value, label);
}

function parseModel(raw: unknown, id: string): CatalogModel {
  const label = `model "${id}"`;
  if (!CATALOG_ID.test(id)) {
    throw new Error(
      `models catalog: ${label} id must be lowercase letters, digits, ".", "_" or "-"`,
    );
  }
  const obj = requireObject(raw, label);
  assertKnownKeys(obj, MODEL_FIELDS, label);
  const keyRef =
    obj.keyRef === undefined ? undefined : requireString(obj.keyRef, `${label}.keyRef`);
  if (keyRef !== undefined && !keyRef.startsWith("op://")) {
    throw new Error(`models catalog: ${label}.keyRef must be an op:// reference, never a key`);
  }
  const apiKeyEnv = optionalEnv(obj.apiKeyEnv, `${label}.apiKeyEnv`);
  if (keyRef !== undefined && apiKeyEnv === undefined) {
    throw new Error(`models catalog: ${label} has a keyRef but no apiKeyEnv to put it in`);
  }
  const apiBaseEnv = optionalEnv(obj.apiBaseEnv, `${label}.apiBaseEnv`);
  const litellmParams = optionalRecord(obj.litellmParams, `${label}.litellmParams`);
  const modelInfo = optionalRecord(obj.modelInfo, `${label}.modelInfo`);
  return {
    id,
    provider: requireString(obj.provider, `${label}.provider`),
    model: requireString(obj.model, `${label}.model`),
    ...(apiBaseEnv === undefined ? {} : { apiBaseEnv }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(keyRef === undefined ? {} : { keyRef }),
    ...(litellmParams === undefined ? {} : { litellmParams }),
    ...(modelInfo === undefined ? {} : { modelInfo }),
    ...(obj.notes === undefined ? {} : { notes: requireString(obj.notes, `${label}.notes`) }),
  };
}

/** Parse and strictly validate an already-`JSON.parse`d catalog. */
export function parseCatalog(json: unknown): ModelCatalog {
  if (!isPlainObject(json)) {
    throw new Error("models catalog: expected a JSON object at the top level");
  }
  assertKnownKeys(json, ["version", "models", "_comment"], "document");
  if (json.version !== 1) {
    throw new Error(
      `models catalog: unsupported version ${JSON.stringify(json.version)} (expected 1)`,
    );
  }
  const modelsObj = requireObject(json.models, "models");
  const models = Object.fromEntries(
    Object.entries(modelsObj).map(([id, raw]) => [id, parseModel(raw, id)]),
  );
  return { version: 1, models };
}
