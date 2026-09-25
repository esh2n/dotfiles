/**
 * `toLitellmModelList` is writer + dry-run only this phase (see
 * `../../app/apply`'s refusal for `--write --target litellm`), so there is
 * no golden byte-for-byte requirement here — just that the generated
 * entries carry the real backend routes and that everything litellm's
 * model_list format cannot express is reported as dropped.
 */

import { describe, expect, test } from "bun:test";
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
    expect(content).toContain("model: lm_studio/qwen/qwen3.8-27b");
  });

  test("the deterministic entry has no api_key line (matches the real file: lm_studio needs none)", () => {
    const { content } = toLitellmModelList(loadRealTiers());
    const detBlock = content.slice(content.indexOf("model_name: deterministic"));
    expect(detBlock).not.toContain("api_key");
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
});
