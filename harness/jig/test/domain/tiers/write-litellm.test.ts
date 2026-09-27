/**
 * `toLitellmModelList` renders each tier's catalog models into the managed
 * block of home/shared/litellm/config/config.yaml, which `jig apply --write`
 * splices in: the real routes, `order` for a tier with several models, the
 * catalog's litellm_params and model_info, and a report of what the
 * model_list format cannot express.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIERS_MANAGED_BLOCK_MARKERS } from "../../../src/domain/tiers/markers";
import { spliceManagedBlock } from "../../../src/domain/tiers/splice";
import { toLitellmModelList } from "../../../src/domain/tiers/write-litellm";
import { loadRealTiers } from "./fixtures";

describe("toLitellmModelList", () => {
  test("renders one entry per tier, in main/complex/deterministic order, with the real backend route", () => {
    const { content } = toLitellmModelList(loadRealTiers());
    const mainIdx = content.indexOf("model_name: main");
    const complexIdx = content.indexOf("model_name: complex");
    const detIdx = content.indexOf("model_name: deterministic");

    expect(mainIdx).toBeGreaterThan(-1);
    expect(complexIdx).toBeGreaterThan(mainIdx);
    expect(detIdx).toBeGreaterThan(complexIdx);

    expect(content).toContain("model: deepseek/deepseek-flash");
    expect(content).toContain("api_key: os.environ/DEEPSEEK_API_KEY");
    expect(content).toContain("model: deepseek/deepseek-v4-pro");
    expect(content).toContain("model: openai/Qwen3.8-27B-Q4_K_M");
  });

  test("the deterministic entry reads the desktop llama-server's key (matches the real file)", () => {
    const { content } = toLitellmModelList(loadRealTiers());
    const detBlock = content.slice(content.indexOf("model_name: deterministic"));
    expect(detBlock).toContain("api_key: os.environ/LLAMA_SERVER_API_KEY");
  });

  test("reports everything outside alias/backend as dropped", () => {
    const { dropped } = toLitellmModelList(loadRealTiers());
    const fields = dropped.map((d) => `${d.tier}:${d.field}`);

    expect(fields).toContain("main:compat");
    expect(fields).toContain("main:samplingParams");
    expect(fields).toContain("main:pi");
    expect(fields).toContain("main:dsh");
    expect(fields).toContain("*:connections.proxy");
  });

  test("a tier with several models gets one entry each, in order, with the catalog's params and model_info", () => {
    const { content } = toLitellmModelList(loadRealTiers());
    const det = content.slice(content.indexOf("# deterministic ←"));
    expect(det.indexOf("order: 1")).toBeLessThan(det.indexOf("order: 2"));
    expect(det).toContain("api_base: os.environ/LLAMA_SERVER_API_BASE");
    expect(det).toContain("      extra_body:\n        ttl: 600");
    expect(det).toContain("    model_info:\n      disable_background_health_check: true");
    expect(content.slice(0, content.indexOf("# complex"))).not.toContain("order:");
  });

  test("[live-verified] the repository's config.yaml holds exactly the generated block", () => {
    const real = readFileSync(
      join(
        import.meta.dir,
        "..",
        "..",
        "..",
        "..",
        "..",
        "home",
        "shared",
        "litellm",
        "config",
        "config.yaml",
      ),
      "utf8",
    );
    const { content } = toLitellmModelList(loadRealTiers());
    expect(spliceManagedBlock(real, content, TIERS_MANAGED_BLOCK_MARKERS)).toBe(real);
  });

  test("an exponent without a decimal point gets one, so YAML reads a float, not a string", () => {
    const policy = loadRealTiers();
    const first = policy.tiers.main.deployments[0];
    if (first === undefined) throw new Error("main has no deployment");
    const withPrice = {
      ...policy,
      tiers: {
        ...policy.tiers,
        main: {
          ...policy.tiers.main,
          deployments: [{ ...first, modelInfo: { a: 1e-9, b: 1.4e-7, c: 90, d: "1e-9" } }],
        },
      },
    };
    const { content } = toLitellmModelList(withPrice);
    expect(content).toContain("      a: 1.0e-9");
    expect(content).toContain("      b: 1.4e-7");
    expect(content).toContain("      c: 90");
    expect(content).toContain('      d: "1e-9"');
  });
});
