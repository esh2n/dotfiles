/**
 * Full settings composition: one generic merge, then six keys re-derived from the
 * per-group originals — hooks (reversed concat), env / enabledPlugins /
 * extraKnownMarketplaces (shallow), permissions.* and mcpServers (replaced by
 * their compiled sidecar documents). Every rule is pinned by a test in
 * test/domain/compose/compose.test.ts.
 *
 * Two things are deliberately NOT part of this pure step: the sed template pass
 * (./template.ts) and the `.autoMode` carry-over from the previous output file
 * (an install-step concern).
 */

import { mergeHooks } from "./hooks";
import type { PackDefinition } from "./layers";
import { type Json, type JsonObject, mergeJson, mergeJsonShallow } from "./merge";

/** The compiled `permissions.yaml` for Claude's settings.json (lib/permissions/to-claude.js). */
export interface PermissionsSidecar {
  readonly allow: readonly Json[];
  readonly deny: readonly Json[];
  readonly defaultMode: string;
}

export interface ComposeInput {
  /** core layer */
  readonly core: JsonObject;
  /** enabled pack layers, alphabetically by name (see ./layers.ts) */
  readonly packs: readonly PackDefinition[];
  /** personal layer */
  readonly personal?: JsonObject | undefined;
  /** compiled permissions document — replaces whatever the layers carried */
  readonly permissions: PermissionsSidecar;
  /** compiled mcp.json inventory — replaces the layers' `mcpServers` */
  readonly mcpServers: JsonObject;
}

function asObject(value: Json | undefined): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

export function composeSettings(input: ComposeInput): JsonObject {
  const personal = input.personal ?? {};

  // Packs merge among themselves with the generic rule first, then the three
  // groups merge — so a later pack REPLACES an earlier pack's array (that is
  // what `reduce ... . * $p` does), and personal still beats both.
  const packsMerged = input.packs.reduce<JsonObject>(
    (acc, pack: PackDefinition) => mergeJson(acc, pack.settings, `pack "${pack.name}"`),
    {},
  );
  const merged = mergeJson(
    mergeJson(input.core, packsMerged, "the enabled packs"),
    personal,
    "the personal layer",
  );

  return {
    ...merged,
    // jq assigns the three fields onto the existing object, so sibling keys of
    // a legacy layer-level `permissions` survive; the three themselves do not.
    permissions: {
      ...asObject(merged.permissions),
      allow: [...input.permissions.allow],
      deny: [...input.permissions.deny],
      defaultMode: input.permissions.defaultMode,
    },
    hooks: mergeHooks({
      core: asObject(input.core.hooks),
      packs: asObject(packsMerged.hooks),
      personal: asObject(personal.hooks),
    }),
    mcpServers: input.mcpServers,
    enabledPlugins: mergeJsonShallow(
      asObject(input.core.enabledPlugins),
      asObject(packsMerged.enabledPlugins),
      asObject(personal.enabledPlugins),
    ),
    extraKnownMarketplaces: mergeJsonShallow(
      asObject(input.core.extraKnownMarketplaces),
      asObject(packsMerged.extraKnownMarketplaces),
      asObject(personal.extraKnownMarketplaces),
    ),
    env: mergeJsonShallow(
      asObject(input.core.env),
      asObject(packsMerged.env),
      asObject(personal.env),
    ),
  };
}
