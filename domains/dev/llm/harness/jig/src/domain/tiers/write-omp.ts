/**
 * Pure writer: canonical `TiersPolicy` -> the `proxy:` provider block of
 * `domains/dev/config/omp/models.yml`, spliced between the shared
 * `# BEGIN jig:tiers` / `# END jig:tiers` markers like dsh's block.
 *
 * Why generated: until 2026-09-24 the block was written by hand and carried
 * no `contextWindow` / `maxTokens`, so omp fell back to its defaults —
 * 128 000 / 16 384 (docs/models.md: "contextWindow … default: 128000") — and
 * treated the 1M-token tiers as 128k, compacting far too early. The values
 * live in policy/tiers.json, the one source pi and dsh already read.
 *
 * omp's models.yml fields (docs/models.md): provider `baseUrl`, `apiKey`
 * (an env var NAME first, then a literal), `api`, `compat` (deep-merged
 * request-shaping overrides), `models[]` with `id`, `name`, `reasoning`,
 * `input`, `contextWindow`, `maxTokens`, `compat`. The two `compat` keys
 * carried here are pi-ai's (omp is a pi derivative) — [unverified] against
 * omp's own schema; a rejection shows up as `omp models ls` listing no
 * proxy tier, which litellm/check.sh probes.
 *
 * `compat.thinkingFormat` is carried only when omp's schema accepts the
 * value — measured 2026-09-24 against omp 18.x: `must be "openai",
 * "openrouter", "zai", "qwen" or "qwen-chat-template" (was "deepseek")`, and
 * one rejected value disables EVERY custom provider ("models.yml validation
 * failed — custom providers disabled"). pi-ai's `deepseek` format is
 * therefore dropped and reported; omp shapes DeepSeek thinking itself.
 *
 * Order pins omp's own: main, complex, deterministic (the canonical order).
 */

/** The `compat.thinkingFormat` values omp's models.yml schema accepts (its own error message, 2026-09-24). */
export const OMP_THINKING_FORMATS: ReadonlySet<string> = new Set([
  "openai",
  "openrouter",
  "zai",
  "qwen",
  "qwen-chat-template",
]);

import type { DroppedField, WriteResult } from "./capability";
import type { Tier, TierId, TiersPolicy } from "./types";
import { HARNESS_USER_AGENT } from "./user-agent";

const OMP_TIER_ORDER: readonly TierId[] = ["main", "complex", "deterministic"];
const INDENT = "  "; // under `providers:`
const P = `${INDENT}  `; // provider fields
const M = `${P}  `; // `- id:` lines
const F = `${M}  `; // model fields

function renderModel(tier: Tier, dropped: DroppedField[]): string {
  dropped.push({ field: "backend", tier: tier.alias, reason: "omp only ever talks to the proxy alias; backend routing is opaque to it" });
  dropped.push({ field: "pi.name", tier: tier.alias, reason: "omp's name is derived from displayName" });
  dropped.push({ field: "dsh.name", tier: tier.alias, reason: "dsh's presentation string" });
  if (tier.dsh.reasoningEfforts) dropped.push({ field: "dsh.reasoningEfforts", tier: tier.alias, reason: "dsh-only effort table" });
  if (tier.dsh._comment) dropped.push({ field: "dsh._comment", tier: tier.alias, reason: "dsh-only comment" });
  if (tier.thinkingLevelMap) dropped.push({ field: "thinkingLevelMap", tier: tier.alias, reason: "pi-only; omp maps effort through the selector suffix (:low|:medium|:high)" });
  if (tier.samplingParams) dropped.push({ field: "samplingParams", tier: tier.alias, reason: "omp's models.yml has no per-model sampling params field in docs/models.md" });
  if (tier.compat.supportsReasoningEffort !== undefined) dropped.push({ field: "compat.supportsReasoningEffort", tier: tier.alias, reason: "not a documented omp compat key" });

  const lines = [
    `${M}- id: ${tier.alias}`,
    `${F}name: ${tier.alias} — ${tier.displayName} (LiteLLM tier)`,
    `${F}reasoning: ${tier.reasoning}`,
    `${F}input: [${tier.input.join(", ")}]`,
    `${F}contextWindow: ${tier.contextWindow}`,
    `${F}maxTokens: ${tier.maxTokens}`,
  ];
  if (tier.compat.thinkingFormat !== undefined) {
    if (OMP_THINKING_FORMATS.has(tier.compat.thinkingFormat)) {
      lines.push(`${F}compat:`, `${F}  thinkingFormat: ${tier.compat.thinkingFormat}`);
    } else {
      dropped.push({
        field: "compat.thinkingFormat",
        tier: tier.alias,
        reason: `omp's schema accepts only ${[...OMP_THINKING_FORMATS].join("/")} (was "${tier.compat.thinkingFormat}"); one bad value disables every custom provider`,
      });
    }
  }
  return lines.join("\n");
}

export function toOmpProxyBlock(policy: TiersPolicy): WriteResult {
  const dropped: DroppedField[] = [];
  const proxy = policy.connections.proxy;
  dropped.push({ field: "connections.proxy.pi", tier: "*", reason: "omp names the env var like dsh does (apiKeyEnv), not pi's $VAR form" });
  dropped.push({ field: "connections.proxy.dsh.displayName", tier: "*", reason: "omp has no provider display name" });

  const lines = [
    `${INDENT}proxy:`,
    `${P}baseUrl: ${proxy.baseUrl}`,
    `${P}apiKey: ${proxy.dsh.apiKeyEnv}`,
    `${P}api: ${proxy.api}`,
    `${P}headers:`,
    `${P}  User-Agent: ${HARNESS_USER_AGENT.omp}`,
    `${P}compat:`,
    `${P}  supportsDeveloperRole: ${proxy.compat.supportsDeveloperRole}`,
    `${P}  maxTokensField: ${proxy.compat.maxTokensField}`,
    `${P}models:`,
    ...OMP_TIER_ORDER.map((id) => renderModel(policy.tiers[id], dropped)),
  ];
  return { content: lines.join("\n"), dropped };
}
