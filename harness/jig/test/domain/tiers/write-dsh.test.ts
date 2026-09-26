/**
 * [live-verified] `toDshModelsBlock`, spliced via `spliceManagedBlock`, is
 * checked against a fixture that is the REAL `dsh/settings.yaml` with the
 * `# BEGIN jig:tiers` / `# END jig:tiers` markers inserted around the
 * `local-proxy:` subtree — i.e. exactly what step 5 (the integration step)
 * hand-edits the real file into. Byte-identical except for the documented,
 * deliberate diffs: `complex`'s stale "Astra" comment corrected to the
 * backend litellm/config.yaml actually routes to, and the deterministic
 * tier's vision-capable note moved from a trailing to a leading comment.
 */

import { describe, expect, test } from "bun:test";
import { TIERS_MANAGED_BLOCK_MARKERS } from "../../../src/domain/tiers/markers";
import { spliceManagedBlock } from "../../../src/domain/tiers/splice";
import { toDshModelsBlock } from "../../../src/domain/tiers/write-dsh";
import { loadRealTiers } from "./fixtures";

const BEFORE = [
  "# DeepSeek Harness (dsh) — model/provider settings plane.",
  "# Symlink to ~/.dsh/settings.yaml. Re-read per request (no restart needed).",
  "# Managed by the Web Models page too; hand-editing round-trips untouched keys.",
  "#",
  "# DSH is one of the two harnesses (with pi) pointed at the local LiteLLM proxy so",
  "# both are measured on the same plane and the better one is chosen with data.",
  "# DSH holds ONLY the proxy's key — the DeepSeek/OpenAI keys live on the proxy,",
  "# so nothing provider-secret lands here. Decision record: writeup store",
  "# yoki/2026-09-16-observability-proxy-litellm.",
  "",
  "llm-pi-ai:",
  "  providers:",
  "    # One custom route -> the local LiteLLM proxy (OpenAI-compatible).",
  "    # BEGIN jig:tiers (generated — edit policy/tiers.json, then jig apply)",
  "    local-proxy:",
  "      displayName: LiteLLM (local)",
  "      api: openai-completions           # LiteLLM speaks OpenAI Chat Completions",
  "      baseURL: http://localhost:4000/v1 # confirm /v1 vs bare :4000 against the running proxy",
  "      apiKeyEnv: LITELLM_API_KEY         # the PROXY master key, injected via `op run` (never on disk)",
  "",
  "      # localhost gateways: pi-ai treats an unknown URL as OpenAI itself and",
  "      # sends fields LiteLLM may reject — these two are the usual fixes and",
  "      # have no UI field, so they must live here.",
  "      compat:",
  "        supportsDeveloperRole: false     # system prompt as `system`, not `developer`",
  "        maxTokensField: max_tokens       # if the proxy rejects max_completion_tokens",
  "",
  "      models:",
  "        # main -> proxy alias that maps to deepseek-flash",
  "        - id: main",
  "          name: main (DeepSeek Flash)",
  "          reasoningEfforts:",
  "            off:",
  "            high: high",
  "            max: max",
  "          compat:",
  "            thinkingFormat: deepseek      # makes `off` actually stop thinking",
  "",
  "        # complex -> proxy alias that maps to gpt-6-astra (Astra)",
  "        - id: complex",
  "          name: complex (Astra)",
  "",
  "        # deterministic -> proxy alias that maps to local qwen",
  "        - id: deterministic",
  "          name: deterministic (local Qwen)",
  "          # add `input: [text, image]` if this qwen build is vision-capable",
  "    # END jig:tiers",
  "",
].join("\n");

const EXPECTED_AFTER = [
  "# DeepSeek Harness (dsh) — model/provider settings plane.",
  "# Symlink to ~/.dsh/settings.yaml. Re-read per request (no restart needed).",
  "# Managed by the Web Models page too; hand-editing round-trips untouched keys.",
  "#",
  "# DSH is one of the two harnesses (with pi) pointed at the local LiteLLM proxy so",
  "# both are measured on the same plane and the better one is chosen with data.",
  "# DSH holds ONLY the proxy's key — the DeepSeek/OpenAI keys live on the proxy,",
  "# so nothing provider-secret lands here. Decision record: writeup store",
  "# yoki/2026-09-16-observability-proxy-litellm.",
  "",
  "llm-pi-ai:",
  "  providers:",
  "    # One custom route -> the local LiteLLM proxy (OpenAI-compatible).",
  "    # BEGIN jig:tiers (generated — edit policy/tiers.json, then jig apply)",
  "    local-proxy:",
  "      displayName: LiteLLM (local)",
  "      api: openai-completions           # LiteLLM speaks OpenAI Chat Completions",
  "      baseURL: http://localhost:4000/v1 # confirm /v1 vs bare :4000 against the running proxy",
  "      apiKeyEnv: LITELLM_API_KEY         # the PROXY master key, injected via `op run` (never on disk)",
  "      headers:",
  "        User-Agent: dsh   # the gateway's per-harness label (user_agent)",
  "",
  "      # localhost gateways: pi-ai treats an unknown URL as OpenAI itself and",
  "      # sends fields LiteLLM may reject — these two are the usual fixes and",
  "      # have no UI field, so they must live here.",
  "      compat:",
  "        supportsDeveloperRole: false     # system prompt as `system`, not `developer`",
  "        maxTokensField: max_tokens       # if the proxy rejects max_completion_tokens",
  "",
  "      models:",
  "        # main -> proxy alias that maps to deepseek-flash",
  "        - id: main",
  "          name: main (DeepSeek Flash)",
  "          reasoningEfforts:",
  "            off:",
  "            high: high",
  "            max: max",
  "          compat:",
  "            thinkingFormat: deepseek      # makes `off` actually stop thinking",
  "",
  "        # complex -> proxy alias that maps to deepseek-v4-pro",
  "        # dsh's hand-written comment still calls this route Astra",
  "        # (gpt-6-astra); litellm/config.yaml actually routes `complex` to",
  "        # deepseek/deepseek-v4-pro today (see that file's own comment on the",
  "        # swap) — pre-existing drift this schema records rather than silently",
  "        # resolving.",
  "        - id: complex",
  "          name: complex (Astra)",
  "",
  "        # deterministic -> proxy alias that maps to Qwen3.8-27B-Q4_K_M",
  "        # add `input: [text, image]` if this qwen build is vision-capable",
  "        - id: deterministic",
  "          name: deterministic (Qwen3.8-27B, desktop GPU)",
  "    # END jig:tiers",
  "",
].join("\n");

describe("toDshModelsBlock + spliceManagedBlock", () => {
  test("[live-verified] reproduces the real settings.yaml semantically, with only the documented diffs", () => {
    const block = toDshModelsBlock(loadRealTiers());
    const result = spliceManagedBlock(BEFORE, block.content, TIERS_MANAGED_BLOCK_MARKERS);
    expect(result).toBe(EXPECTED_AFTER);
  });

  test("everything outside the markers is untouched", () => {
    const block = toDshModelsBlock(loadRealTiers());
    const result = spliceManagedBlock(BEFORE, block.content, TIERS_MANAGED_BLOCK_MARKERS);
    const beforeHeader = BEFORE.split("# BEGIN jig:tiers")[0];
    const afterHeader = result.split("# BEGIN jig:tiers")[0];
    expect(afterHeader).toBe(beforeHeader);
  });

  test("reports what dsh's format cannot express", () => {
    const { dropped } = toDshModelsBlock(loadRealTiers());
    const fields = dropped.map((d) => `${d.tier}:${d.field}`);

    expect(fields).toContain("main:contextWindow");
    expect(fields).toContain("main:backend");
    expect(fields).toContain("deterministic:samplingParams");
    expect(fields).toContain("deterministic:thinkingLevelMap");
    expect(fields).toContain("complex:compat.thinkingFormat");
    expect(fields).toContain("deterministic:compat.thinkingFormat");
    expect(fields).toContain("*:connections.proxy.pi");
  });

  test("never reports main:compat.thinkingFormat as dropped (dsh does carry it for main)", () => {
    const { dropped } = toDshModelsBlock(loadRealTiers());
    const fields = dropped.map((d) => `${d.tier}:${d.field}`);
    expect(fields).not.toContain("main:compat.thinkingFormat");
  });
});
