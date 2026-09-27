/**
 * Pure writer: canonical `TiersPolicy` (tiers resolved against the model
 * catalog) -> the managed `model_list` entries of
 * `home/shared/litellm/config/config.yaml`, between the jig:tiers markers.
 *
 * Each tier becomes one entry per catalog model it uses, all under the tier's
 * name. With more than one, `order` is their position: LiteLLM sends to
 * `order: 1` and moves to the next only when it fails (docs/routing.md). The
 * catalog entry's `litellmParams` and `modelInfo` are carried as they are, so
 * a deployment's cooldown, prices or health-check opt-out live in
 * `policy/models.json`, never here
 * (rules/decisions/2026-09-27-model-catalog-and-tier-assignment.md).
 *
 * Everything in the tier schema that is about the harnesses (compat,
 * sampling, effort maps, the context budget, pi/dsh presentation) is
 * reported as dropped.
 */

import type { DroppedField, WriteResult } from "./capability";
import type { CatalogModel } from "./catalog";
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

const PLAIN = /^[A-Za-z0-9_./:@+-]+$/;

/** A YAML scalar: plain when it cannot be misread, JSON-quoted otherwise. */
function scalar(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (typeof value === "string") {
    const ambiguous = /^(true|false|null|yes|no|on|off|~|[-+]?[0-9.]+)$/i.test(value);
    return PLAIN.test(value) && !ambiguous ? value : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** `key: value` lines for a record, nested records indented two more spaces. */
function yamlLines(record: Readonly<Record<string, unknown>>, indent: string): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      lines.push(...yamlLines(value as Record<string, unknown>, `${indent}  `));
    } else if (Array.isArray(value)) {
      lines.push(`${indent}${key}: [${value.map(scalar).join(", ")}]`);
    } else {
      lines.push(`${indent}${key}: ${scalar(value)}`);
    }
  }
  return lines;
}

/** A note as `#` comment lines of at most ~76 characters. */
function commentLines(text: string, indent: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line !== "" && line.length + 1 + word.length > 76) {
      out.push(`${indent}# ${line}`);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") out.push(`${indent}# ${line}`);
  return out;
}

function renderDeployment(
  tier: Tier,
  model: CatalogModel,
  position: number,
  ordered: boolean,
): string[] {
  const lines: string[] = [];
  lines.push(`  # ${tier.alias} ← ${model.id}${ordered ? ` (order ${position})` : ""}`);
  if (model.notes !== undefined) lines.push(...commentLines(model.notes, "  "));
  lines.push(`  - model_name: ${tier.alias}`);
  lines.push("    litellm_params:");
  lines.push(`      model: ${model.provider}/${model.model}`);
  if (model.apiBaseEnv !== undefined) lines.push(`      api_base: os.environ/${model.apiBaseEnv}`);
  if (model.apiKeyEnv !== undefined) lines.push(`      api_key: os.environ/${model.apiKeyEnv}`);
  if (ordered) lines.push(`      order: ${position}`);
  if (model.litellmParams !== undefined) lines.push(...yamlLines(model.litellmParams, "      "));
  if (model.modelInfo !== undefined) {
    lines.push("    model_info:");
    lines.push(...yamlLines(model.modelInfo, "      "));
  }
  return lines;
}

function renderTier(tier: Tier, dropped: DroppedField[]): string {
  for (const field of NOT_EXPRESSIBLE_TIER_FIELDS) {
    dropped.push({
      field,
      tier: tier.alias,
      reason:
        "litellm's model_list entry carries only the route to the model, not how a harness uses it",
    });
  }
  const ordered = tier.deployments.length > 1;
  return tier.deployments
    .map((model, i) => renderDeployment(tier, model, i + 1, ordered).join("\n"))
    .join("\n\n");
}

export function toLitellmModelList(policy: TiersPolicy): WriteResult {
  const dropped: DroppedField[] = [];
  const entries = LITELLM_TIER_ORDER.map((id) => renderTier(policy.tiers[id], dropped));

  dropped.push({
    field: "connections.proxy",
    tier: "*",
    reason: "litellm IS the proxy; connection facts describe how clients reach it, not itself",
  });

  return { content: entries.join("\n\n"), dropped };
}
