/**
 * Pure writer: canonical `TiersPolicy` -> the managed `local-proxy:` provider
 * subtree of `home/shared/harness/dsh/settings.yaml`. Returns ONLY that
 * subtree's text (4-space indented, matching where `local-proxy:` sits under
 * `llm-pi-ai: / providers:` in the real file) — `./splice.ts` +
 * `./markers.ts` do the actual insertion into the full file, since that file
 * is also written by hand (once, to add the markers) and by dsh's own Web
 * Models page.
 *
 * dsh's schema is much thinner than pi's: it has no per-model
 * `contextWindow` / `maxTokens` / `reasoning` / `input` / `samplingParams` /
 * `thinkingLevelMap` fields at all (those are static specs a maintainer
 * only ever passes to pi's client; dsh presumably learns equivalent facts
 * from the proxy live). Every one of those is reported as dropped.
 */

import type { DroppedField, WriteResult } from "./capability";
import type { Tier, TierId, TiersPolicy } from "./types";
import { HARNESS_USER_AGENT } from "./user-agent";

// dsh's real file orders tiers main, complex, deterministic.
const DSH_TIER_ORDER: readonly TierId[] = ["main", "complex", "deterministic"];

const INDENT = "    "; // local-proxy: sits 4 spaces under llm-pi-ai: / providers:

function wrapComment(text: string, indent: string, width = 78): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (`${indent}# ${candidate}`.length > width && current !== "") {
      lines.push(`${indent}# ${current}`);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(`${indent}# ${current}`);
  return lines;
}

function dropTierFields(tier: Tier, dropped: DroppedField[]): void {
  const notExpressible: ReadonlyArray<[string, unknown]> = [
    ["maxContextWindow", tier.maxContextWindow],
    ["reasoning", tier.reasoning],
    ["input", tier.input],
    ["contextWindow", tier.contextWindow],
    ["maxTokens", tier.maxTokens],
    ["backend", tier.backend],
  ];
  for (const [field] of notExpressible) {
    dropped.push({
      field,
      tier: tier.alias,
      reason:
        "dsh's models schema has no field for this — it is a static spec pi's client needs that dsh does not carry",
    });
  }
  if (tier.compat.supportsReasoningEffort !== undefined) {
    dropped.push({
      field: "compat.supportsReasoningEffort",
      tier: tier.alias,
      reason: "dsh's compat block only ever carries thinkingFormat",
    });
  }
  if (tier.compat.thinkingFormat && tier.dsh.compat?.thinkingFormat === undefined) {
    dropped.push({
      field: "compat.thinkingFormat",
      tier: tier.alias,
      reason:
        "dsh's real file does not set compat.thinkingFormat for this tier today (pre-existing gap, not a hard format limit) — dsh.compat is authoritative for what dsh actually renders",
    });
  }
  if (tier.thinkingLevelMap) {
    dropped.push({
      field: "thinkingLevelMap",
      tier: tier.alias,
      reason: "dsh expresses effort via reasoningEfforts, not thinkingLevelMap",
    });
  }
  if (tier.samplingParams) {
    dropped.push({
      field: "samplingParams",
      tier: tier.alias,
      reason: "dsh's models schema has no sampling-params field",
    });
  }
  dropped.push({
    field: "pi.name",
    tier: tier.alias,
    reason: "dsh has its own dsh.name presentation string",
  });
}

// One list item ("- id: …") nests one level deeper than the `models:` key
// itself (8 spaces vs. 6); its own fields nest one level deeper still.
const MODEL_INDENT = `${INDENT}    `;
const FIELD_INDENT = `${INDENT}      `;
const SUB_INDENT = `${INDENT}        `;

function renderTierBlock(tier: Tier, dropped: DroppedField[]): string {
  dropTierFields(tier, dropped);

  const lines: string[] = [];
  lines.push(`${MODEL_INDENT}# ${tier.alias} -> proxy alias that maps to ${tier.backend.model}`);
  if (tier.dsh._comment?.name) {
    lines.push(...wrapComment(tier.dsh._comment.name, MODEL_INDENT));
  }
  lines.push(`${MODEL_INDENT}- id: ${tier.alias}`);
  lines.push(`${FIELD_INDENT}name: ${tier.dsh.name}`);

  if (tier.dsh.reasoningEfforts) {
    lines.push(`${FIELD_INDENT}reasoningEfforts:`);
    for (const [key, value] of Object.entries(tier.dsh.reasoningEfforts)) {
      lines.push(value === null ? `${SUB_INDENT}${key}:` : `${SUB_INDENT}${key}: ${value}`);
    }
  }

  if (tier.dsh.compat?.thinkingFormat) {
    const comment = tier.dsh._comment?.thinkingFormat
      ? `      # ${tier.dsh._comment.thinkingFormat}`
      : "";
    lines.push(`${FIELD_INDENT}compat:`);
    lines.push(`${SUB_INDENT}thinkingFormat: ${tier.dsh.compat.thinkingFormat}${comment}`);
  }

  return lines.join("\n");
}

export function toDshModelsBlock(policy: TiersPolicy): WriteResult {
  const dropped: DroppedField[] = [];
  const proxy = policy.connections.proxy;

  const lines: string[] = [];
  lines.push(`${INDENT}local-proxy:`);
  lines.push(`${INDENT}  displayName: ${proxy.dsh.displayName}`);
  lines.push(
    `${INDENT}  api: ${proxy.api}${proxy._comment?.api ? `           # ${proxy._comment.api}` : ""}`,
  );
  lines.push(
    `${INDENT}  baseURL: ${proxy.baseUrl}${proxy._comment?.baseUrl ? ` # ${proxy._comment.baseUrl}` : ""}`,
  );
  lines.push(
    `${INDENT}  apiKeyEnv: ${proxy.dsh.apiKeyEnv}${
      proxy.dsh._comment?.apiKeyEnv ? `         # ${proxy.dsh._comment.apiKeyEnv}` : ""
    }`,
  );
  lines.push(`${INDENT}  headers:`);
  lines.push(
    `${INDENT}    User-Agent: ${HARNESS_USER_AGENT.dsh}   # the gateway's per-harness label (user_agent)`,
  );
  lines.push("");
  if (proxy._comment?.compat) {
    lines.push(...wrapComment(proxy._comment.compat, `${INDENT}  `));
  }
  lines.push(`${INDENT}  compat:`);
  lines.push(
    `${INDENT}    supportsDeveloperRole: ${proxy.compat.supportsDeveloperRole}${
      proxy._comment?.supportsDeveloperRole ? `     # ${proxy._comment.supportsDeveloperRole}` : ""
    }`,
  );
  lines.push(
    `${INDENT}    maxTokensField: ${proxy.compat.maxTokensField}${
      proxy._comment?.maxTokensField ? `       # ${proxy._comment.maxTokensField}` : ""
    }`,
  );
  lines.push("");
  lines.push(`${INDENT}  models:`);

  const blocks = DSH_TIER_ORDER.map((id) => renderTierBlock(policy.tiers[id], dropped));
  lines.push(blocks.join("\n\n"));

  dropped.push({
    field: "connections.proxy.pi",
    tier: "*",
    reason: "dsh has its own connections.proxy.dsh.apiKeyEnv; pi's apiKey doesn't apply",
  });

  return { content: lines.join("\n"), dropped };
}
