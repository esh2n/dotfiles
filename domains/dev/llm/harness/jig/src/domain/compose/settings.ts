/**
 * Settings composition — pure. Merge ordered layers (core -> packs -> personal)
 * into one settings object with the compose rule:
 *   - objects deep-merge by key,
 *   - arrays concatenate (so hook registrations accumulate across layers),
 *   - scalars (and type mismatches) are last-wins.
 * No IO, no mutation of the inputs.
 */

export type Json = string | number | boolean | null | Json[] | { readonly [key: string]: Json };

export type SettingsFragment = { readonly [key: string]: Json };

export interface Layer {
  readonly name: string;
  readonly settings: SettingsFragment;
}

function isObject(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValue(base: Json, next: Json): Json {
  if (Array.isArray(base) && Array.isArray(next)) return [...base, ...next];
  if (isObject(base) && isObject(next)) return mergeObjects(base, next);
  return next;
}

function mergeObjects(
  base: { readonly [key: string]: Json },
  next: { readonly [key: string]: Json },
): { readonly [key: string]: Json } {
  const out: Record<string, Json> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const existing = out[key];
    out[key] = existing === undefined ? value : mergeValue(existing, value);
  }
  return out;
}

export function mergeSettings(layers: readonly Layer[]): SettingsFragment {
  let acc: { readonly [key: string]: Json } = {};
  for (const layer of layers) {
    acc = mergeObjects(acc, layer.settings);
  }
  return acc;
}
