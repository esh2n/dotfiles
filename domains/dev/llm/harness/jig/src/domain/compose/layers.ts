/**
 * Layer selection — pure. Turn a compose input (core + all pack definitions +
 * the enabled set + optional personal) into the ordered list of layers to merge:
 * core first, then the enabled packs in their definition order, then personal.
 * An enabled name with no matching pack is a loud error, not a silent skip.
 */

import { type Layer, mergeSettings, type SettingsFragment } from "./settings";

export interface PackDefinition {
  readonly name: string;
  readonly settings: SettingsFragment;
}

export interface ComposeInput {
  readonly core: SettingsFragment;
  readonly packs: readonly PackDefinition[];
  readonly enabled: readonly string[];
  readonly personal?: SettingsFragment;
}

export function selectLayers(input: ComposeInput): Layer[] {
  const known = new Set(input.packs.map((pack) => pack.name));
  for (const name of input.enabled) {
    if (!known.has(name)) throw new Error(`unknown pack: ${name}`);
  }

  const enabled = new Set(input.enabled);
  const layers: Layer[] = [{ name: "core", settings: input.core }];
  for (const pack of input.packs) {
    if (enabled.has(pack.name)) layers.push({ name: pack.name, settings: pack.settings });
  }
  if (input.personal !== undefined) layers.push({ name: "personal", settings: input.personal });
  return layers;
}

export function composeSettings(input: ComposeInput): SettingsFragment {
  return mergeSettings(selectLayers(input));
}
