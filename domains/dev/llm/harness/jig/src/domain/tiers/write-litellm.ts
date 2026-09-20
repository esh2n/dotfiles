/**
 * Pure writer: canonical `TiersPolicy` -> the managed `model_list` entries of
 * `domains/dev/config/litellm/config.yaml`. Unlike the pi and dsh writers,
 * this one is dry-run / review-only this phase (see `../../app/apply`) — the
 * measurement plane is deliberately not auto-written, so `jig apply --write`
 * refuses this target regardless of what this function produces.
 *
 * litellm only needs the alias and the real backend route: everything else
 * in the canonical schema (compat, sampling, effort maps, pi/dsh
 * presentation) is reported as dropped.
 */

import type { DroppedField, WriteResult } from "./capability";
import type { Tier, TierId, TiersPolicy } from "./types";

const LITELLM_TIER_ORDER: readonly TierId[] = ["main", "complex", "deterministic"];

const NOT_EXPRESSIBLE_TIER_FIELDS = [
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

function renderEntry(tier: Tier, dropped: DroppedField[]): string {
  for (const field of NOT_EXPRESSIBLE_TIER_FIELDS) {
    dropped.push({
      field,
      tier: tier.alias,
      reason: "litellm's model_list entry only carries model_name and litellm_params.model/api_key",
    });
  }

  const lines: string[] = [];
  lines.push(`  # ${tier.alias} — ${tier.displayName}`);
  lines.push(`  - model_name: ${tier.alias}`);
  lines.push("    litellm_params:");
  lines.push(`      model: ${tier.backend.provider}/${tier.backend.model}`);
  if (tier.backend.apiKeyEnv) {
    lines.push(`      api_key: os.environ/${tier.backend.apiKeyEnv}`);
  }
  return lines.join("\n");
}

export function toLitellmModelList(policy: TiersPolicy): WriteResult {
  const dropped: DroppedField[] = [];
  const entries = LITELLM_TIER_ORDER.map((id) => renderEntry(policy.tiers[id], dropped));

  dropped.push({
    field: "connections.proxy",
    tier: "*",
    reason: "litellm IS the proxy; connection facts describe how clients reach it, not itself",
  });

  return { content: entries.join("\n\n"), dropped };
}
