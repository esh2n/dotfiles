/**
 * `toOmpProxyBlock` against the REAL policy/tiers.json: the block omp's
 * models.yml carries between the jig:tiers markers must name every tier
 * with the context window and output cap tiers.json holds — the numbers
 * omp otherwise defaults to 128000 / 16384 (docs/models.md).
 */

import { describe, expect, test } from "bun:test";
import { TIERS_MANAGED_BLOCK_MARKERS } from "../../../src/domain/tiers/markers";
import { spliceManagedBlock } from "../../../src/domain/tiers/splice";
import { toOmpProxyBlock } from "../../../src/domain/tiers/write-omp";
import { loadRealTiers } from "./fixtures";

describe("toOmpProxyBlock", () => {
  const policy = loadRealTiers();
  const { content, dropped } = toOmpProxyBlock(policy);

  test("names the proxy connection the way omp's models.yml reads it: env var name, api, compat", () => {
    expect(content).toContain(
      "  proxy:\n    baseUrl: http://localhost:4000/v1\n    apiKey: LITELLM_API_KEY\n    api: openai-completions\n",
    );
    expect(content).toContain(
      "    headers:\n      User-Agent: omp\n    compat:\n      supportsDeveloperRole: false\n      maxTokensField: max_tokens\n",
    );
  });

  test("every tier carries contextWindow and maxTokens from tiers.json, in main/complex/deterministic order", () => {
    const ids = [...content.matchAll(/^ {6}- id: (\w+)$/gm)].map((m) => m[1]);
    expect(ids).toEqual(["main", "complex", "deterministic"]);
    for (const id of ids) {
      const tier = policy.tiers[id as "main" | "complex" | "deterministic"];
      expect(content).toContain(`      - id: ${id}\n`);
      expect(content).toContain(`        contextWindow: ${tier.contextWindow}\n`);
      expect(content).toContain(`        maxTokens: ${tier.maxTokens}\n`);
      expect(content).toContain(`        reasoning: ${tier.reasoning}\n`);
    }
    // the values omp would otherwise assume never appear as a 1M tier's window
    expect(content).not.toContain("contextWindow: 128000");
  });

  test("the provider window travels as maxContextWindow (omp's /extended-context) beside the budget", () => {
    // ruling 2026-09-27 (context-budget-1m-85pct): the budget is the 1M provider
    // window itself; only omp has the second field
    expect(content).toContain(
      "      - id: main\n        name: main — DeepSeek Flash (LiteLLM tier)\n        reasoning: true\n        input: [text]\n        contextWindow: 1000000\n        maxContextWindow: 1000000\n",
    );
    expect(content).toContain("      - id: complex\n");
    // the local tier has no extended window
    const det = content.slice(content.indexOf("- id: deterministic"));
    expect(det).not.toContain("maxContextWindow");
  });

  test("splices into a models.yml whose proxy block sits between the markers, leaving the rest alone", () => {
    const before = [
      "providers:",
      "  lm-studio:",
      "    baseUrl: http://127.0.0.1:9/v1",
      "    models: []",
      `  ${TIERS_MANAGED_BLOCK_MARKERS.begin}`,
      "  proxy:",
      "    models: []",
      `  ${TIERS_MANAGED_BLOCK_MARKERS.end}`,
      "",
    ].join("\n");
    const after = spliceManagedBlock(before, content, TIERS_MANAGED_BLOCK_MARKERS);
    expect(after).toContain("  lm-studio:\n    baseUrl: http://127.0.0.1:9/v1\n");
    expect(after).toContain("        contextWindow: 1000000\n        maxContextWindow: 1000000\n");
    expect(after.startsWith("providers:\n")).toBe(true);
  });

  test("what omp cannot express is reported, never silently dropped", () => {
    const fields = new Set(dropped.map((d) => d.field));
    expect(fields).toContain("backend");
    expect(fields).toContain("connections.proxy.pi");
  });

  test("a thinkingFormat omp's schema rejects (pi-ai's deepseek) is left out and reported; an accepted one is kept", () => {
    // measured 2026-09-24: one rejected value disables every custom provider
    expect(content).not.toContain("thinkingFormat: deepseek");
    expect(content).toContain("thinkingFormat: qwen-chat-template");
    const reasons = dropped.filter((d) => d.field === "compat.thinkingFormat").map((d) => d.tier);
    expect(reasons).toEqual(["main", "complex"]);
  });
});
