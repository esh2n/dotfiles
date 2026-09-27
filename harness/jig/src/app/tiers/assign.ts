/**
 * `jig tiers use <tier> <model>...`: point a tier at catalog models, as a
 * rewrite of `policy/tiers.json`'s `use` field only. The result is parsed
 * against the catalog before it is returned, so a tier can never be left
 * pointing at a model the catalog does not have
 * (rules/decisions/2026-09-27-model-catalog-and-tier-assignment.md).
 */

import { parseCatalog } from "../../domain/tiers/catalog";
import { parseTiers } from "../../domain/tiers/parse";
import { TIER_IDS, type TierId } from "../../domain/tiers/types";

function isTier(name: string): name is TierId {
  return (TIER_IDS as readonly string[]).includes(name);
}

/** The new tiers.json text with `tier` using `models`, in that order. */
export function assignTier(
  tiersText: string,
  catalogText: string,
  tier: string,
  models: readonly string[],
): string {
  if (!isTier(tier)) {
    throw new Error(`unknown tier "${tier}" (tiers: ${TIER_IDS.join(", ")})`);
  }
  if (models.length === 0) {
    throw new Error("name at least one catalog model");
  }
  const doc = JSON.parse(tiersText) as { tiers: Record<string, Record<string, unknown>> };
  const current = doc.tiers?.[tier];
  if (current === undefined) {
    throw new Error(`tiers.json has no tier "${tier}"`);
  }
  const next = {
    ...doc,
    tiers: { ...doc.tiers, [tier]: { ...current, use: [...models] } },
  };
  const catalog = parseCatalog(JSON.parse(catalogText));
  parseTiers(next, catalog); // throws on a model the catalog lacks
  return `${JSON.stringify(next, null, 2)}\n`;
}

/** Each tier with the models it uses, then the catalog's ids. */
export function describeTiers(tiersText: string, catalogText: string): string {
  const catalog = parseCatalog(JSON.parse(catalogText));
  const policy = parseTiers(JSON.parse(tiersText), catalog);
  const width = Math.max(...TIER_IDS.map((id) => id.length));
  const lines = TIER_IDS.map((id) => `${id.padEnd(width)}  ${policy.tiers[id].use.join(" → ")}`);
  lines.push("", `catalog: ${Object.keys(catalog.models).join(", ")}`);
  return `${lines.join("\n")}\n`;
}
