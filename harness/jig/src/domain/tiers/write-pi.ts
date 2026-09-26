/**
 * Pure writer: canonical `TiersPolicy` -> `home/shared/harness/pi/models.json`
 * content. pi's format is plain JSON, so it can express every canonical
 * field except dsh's own presentation (`dsh.name`, `dsh.reasoningEfforts`,
 * `dsh._comment`) and `backend` (pi only ever talks to the proxy alias —
 * which provider is behind it is opaque on purpose). Those are reported in
 * the returned capability report, never silently swallowed.
 *
 * `models[].id` order in the real file is main, deterministic, complex —
 * NOT the canonical main/complex/deterministic order — so that order is
 * pinned here explicitly rather than derived from object iteration.
 */

import type { DroppedField, WriteResult } from "./capability";
import type { Tier, TierId, TiersPolicy } from "./types";
import { HARNESS_USER_AGENT } from "./user-agent";

const PI_TIER_ORDER: readonly TierId[] = ["main", "deterministic", "complex"];

/** JSON has no distinct "1.0" — a whole-number sampling temperature is written with one decimal place, matching the source file's style. */
function formatNumberLiteral(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

function rawTemperatureToken(alias: string): string {
  return `__JIG_RAW_TEMPERATURE__${alias}__`;
}

function buildPiModel(tier: Tier, dropped: DroppedField[]): Record<string, unknown> {
  dropped.push({
    field: "dsh.name",
    tier: tier.alias,
    reason: "pi has its own pi.name presentation string",
  });
  if (tier.dsh.reasoningEfforts) {
    dropped.push({
      field: "dsh.reasoningEfforts",
      tier: tier.alias,
      reason:
        "pi has no reasoningEfforts field; it expresses effort via thinkingLevelMap / compat.thinkingFormat",
    });
  }
  if (tier.dsh._comment) {
    dropped.push({
      field: "dsh._comment",
      tier: tier.alias,
      reason: "pi/models.json is plain JSON with no comment fields",
    });
  }
  dropped.push({
    field: "backend",
    tier: tier.alias,
    reason: "pi only ever talks to the proxy alias; backend routing is opaque to it",
  });
  if (tier.maxContextWindow !== undefined) {
    dropped.push({
      field: "maxContextWindow",
      tier: tier.alias,
      reason: "pi has no extended-window field; the budget (contextWindow) is its only window",
    });
  }

  const model: Record<string, unknown> = {
    id: tier.alias,
    name: tier.pi.name,
    reasoning: tier.reasoning,
    input: [...tier.input],
    contextWindow: tier.contextWindow,
    maxTokens: tier.maxTokens,
    compat: { ...tier.compat },
  };
  if (tier.thinkingLevelMap) {
    model.thinkingLevelMap = { ...tier.thinkingLevelMap };
  }
  if (tier.samplingParams) {
    model.samplingParams = {
      temperature: rawTemperatureToken(tier.alias),
      top_p: tier.samplingParams.top_p,
      top_k: tier.samplingParams.top_k,
    };
  }
  return model;
}

export function toPiModels(policy: TiersPolicy): WriteResult {
  const dropped: DroppedField[] = [];
  const proxy = policy.connections.proxy;

  dropped.push({
    field: "connections.proxy.dsh",
    tier: "*",
    reason:
      "pi has its own connections.proxy.pi.apiKey; dsh's displayName/apiKeyEnv/_comment don't apply",
  });
  if (proxy._comment) {
    dropped.push({
      field: "connections.proxy._comment",
      tier: "*",
      reason: "pi/models.json is plain JSON with no comment fields",
    });
  }

  const models = PI_TIER_ORDER.map((id) => buildPiModel(policy.tiers[id], dropped));

  const doc = {
    providers: {
      proxy: {
        baseUrl: proxy.baseUrl,
        api: proxy.api,
        apiKey: proxy.pi.apiKey,
        headers: { "User-Agent": HARNESS_USER_AGENT.pi },
        compat: { ...proxy.compat },
        models,
      },
    },
  };

  let text = `${JSON.stringify(doc, null, 2)}\n`;
  for (const tier of Object.values(policy.tiers)) {
    if (tier.samplingParams) {
      text = text.replaceAll(
        `"${rawTemperatureToken(tier.alias)}"`,
        formatNumberLiteral(tier.samplingParams.temperature),
      );
    }
  }

  return { content: text, dropped };
}
