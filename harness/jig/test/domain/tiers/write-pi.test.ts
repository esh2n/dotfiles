/**
 * [live-verified] `toPiModels` regenerated from the REAL `tiers.json` must
 * equal the REAL `home/shared/harness/pi/models.json` byte-for-byte — that's
 * the golden requirement: tiers.json was reverse-engineered FROM this file,
 * so the round trip must be exact.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toPiModels } from "../../../src/domain/tiers/write-pi";
import { loadRealTiers } from "./fixtures";

const REAL_PI_MODELS_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  "home",
  "shared",
  "harness",
  "pi",
  "models.json",
);

describe("toPiModels", () => {
  test("[live-verified] reproduces the real pi/models.json exactly", () => {
    const real = readFileSync(REAL_PI_MODELS_PATH, "utf8");
    const generated = toPiModels(loadRealTiers());
    expect(generated.content).toBe(real);
  });

  test("reports what pi's format cannot express", () => {
    const { dropped } = toPiModels(loadRealTiers());
    const fields = dropped.map((d) => `${d.tier}:${d.field}`);

    expect(fields).toContain("*:connections.proxy.dsh");
    expect(fields).toContain("main:backend");
    expect(fields).toContain("main:dsh.name");
    expect(fields).toContain("main:dsh.reasoningEfforts");
    expect(fields).toContain("complex:backend");
    expect(fields).toContain("deterministic:backend");
  });

  test("never drops a field pi's own schema can express", () => {
    const { dropped } = toPiModels(loadRealTiers());
    for (const d of dropped) {
      expect(d.field).not.toMatch(/^compat\./);
      expect(d.field).not.toBe("thinkingLevelMap");
      expect(d.field).not.toBe("samplingParams");
      expect(d.field).not.toBe("contextWindow");
      expect(d.field).not.toBe("maxTokens");
    }
  });
});
