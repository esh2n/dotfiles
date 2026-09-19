/**
 * Generic settings merge — the `core * packsMerged * personal` step.
 *
 * The object operator (verified against the real jq binary, see
 * test/domain/compose/merge.test.ts) is: objects recurse; EVERY other value —
 * arrays, null, strings, numbers, booleans — takes the right-hand value. In
 * particular arrays are replaced, never concatenated. The one exception is the
 * `hooks` key, which is re-derived afterwards (./hooks.ts).
 *
 * Nothing here does IO or mutates its inputs.
 */

export type Json = string | number | boolean | null | Json[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: Json;
}

export interface Layer {
  readonly name: string;
  readonly settings: JsonObject;
}

/**
 * Keys that would rewrite an object's prototype instead of adding a property.
 * Well-formed layers never contain them, so a layer that does is either corrupt
 * or hostile — fail loudly rather than dropping data (jig v1 dropped the key
 * and polluted Object.prototype).
 */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafe(value: Json, where: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafe(item, `${where}[${index}]`));
    return;
  }
  if (!isJsonObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`unsafe key "${key}" in ${where || "<root>"} — refusing to merge`);
    }
    assertSafe(item, where === "" ? key : `${where}.${key}`);
  }
}

function mergeObjects(base: JsonObject, next: JsonObject): JsonObject {
  // Copy via a null-prototype accumulator so even an unforeseen key can never
  // reach Object.prototype.
  const out = Object.create(null) as Record<string, Json>;
  for (const [key, value] of Object.entries(base)) out[key] = value;
  for (const [key, value] of Object.entries(next)) {
    const existing = Object.hasOwn(out, key) ? out[key] : undefined;
    out[key] =
      existing === undefined || !isJsonObject(existing) || !isJsonObject(value)
        ? value
        : mergeObjects(existing, value);
  }
  return { ...out };
}

/** Merge one layer onto another with jq `*` semantics. `where` names the layer in error messages. */
export function mergeJson(base: JsonObject, next: JsonObject, where = "layer"): JsonObject {
  assertSafe(next, where);
  return mergeObjects(base, next);
}

/** Merge ordered layers (core → enabled packs → personal) with jq `*` semantics. */
export function mergeLayers(layers: readonly Layer[]): JsonObject {
  let acc: JsonObject = {};
  for (const layer of layers) {
    assertSafe(layer.settings, `layer "${layer.name}"`);
    acc = mergeObjects(acc, layer.settings);
  }
  return acc;
}

/** Shallow merge (`jq +`): one level, later argument wins, no key held back. */
export function mergeJsonShallow(...layers: readonly JsonObject[]): JsonObject {
  const out: Record<string, Json> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (UNSAFE_KEYS.has(key)) throw new Error(`unsafe key "${key}" — refusing to merge`);
      out[key] = value;
    }
  }
  return out;
}
