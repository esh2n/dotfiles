/**
 * Layer selection — pure. Turn the profile declaration (core + every pack
 * definition + the enabled set + optional personal) into the ordered group of
 * layers the compose step consumes.
 *
 * Order is NOT the definition order and not the order they were enabled in: the
 * enabled set is read as names with duplicates removed, and the pack layers are
 * pushed ALPHABETICAL by pack name — observable whenever two enabled packs set the
 * same key (the later one wins).
 *
 * An enabled name with no pack definition is reported in `skipped`, not thrown:
 * the caller decides how loud that is, and the merge result is the same either way.
 */

import type { JsonObject } from "./merge";

export interface PackDefinition {
  readonly name: string;
  readonly settings: JsonObject;
}

export interface LayerSelectionInput {
  readonly core: JsonObject;
  readonly packs: readonly PackDefinition[];
  readonly enabled: readonly string[];
  readonly personal?: JsonObject | undefined;
}

export interface SelectedLayers {
  readonly core: JsonObject;
  /** enabled packs, alphabetically by name, duplicates removed */
  readonly packs: readonly PackDefinition[];
  readonly personal?: JsonObject | undefined;
  /** enabled names with no pack definition — warned about, not fatal */
  readonly skipped: readonly string[];
}

export function selectLayers(input: LayerSelectionInput): SelectedLayers {
  const definitions = new Map(input.packs.map((pack) => [pack.name, pack]));
  const enabledNames = [...new Set(input.enabled)].sort();

  const packs: PackDefinition[] = [];
  const skipped: string[] = [];
  for (const name of enabledNames) {
    const definition = definitions.get(name);
    if (definition === undefined) skipped.push(name);
    else packs.push(definition);
  }

  return input.personal === undefined
    ? { core: input.core, packs, skipped }
    : { core: input.core, packs, skipped, personal: input.personal };
}
