import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assignTier, describeTiers } from "../../../src/app/tiers/assign";
import { REAL_CATALOG_PATH, REAL_TIERS_PATH } from "../../domain/tiers/fixtures";

const tiers = readFileSync(REAL_TIERS_PATH, "utf8");
const catalog = readFileSync(REAL_CATALOG_PATH, "utf8");

describe("assignTier", () => {
  test("rewrites only the tier's use, keeping the file's shape", () => {
    const next = assignTier(tiers, catalog, "main", ["mimo-v2.6-flash"]);
    const before = JSON.parse(tiers);
    const after = JSON.parse(next);
    expect(after.tiers.main.use).toEqual(["mimo-v2.6-flash"]);
    expect({ ...after.tiers.main, use: before.tiers.main.use }).toEqual(before.tiers.main);
    expect(after.tiers.complex).toEqual(before.tiers.complex);
    expect(Object.keys(after.tiers.main)).toEqual(Object.keys(before.tiers.main));
    expect(next.endsWith("}\n")).toBe(true);
  });

  test("the repository's tiers.json is already in the written shape", () => {
    const current = JSON.parse(tiers).tiers.main.use as string[];
    expect(assignTier(tiers, catalog, "main", current)).toBe(tiers);
  });

  test("refuses an unknown tier, an unknown model and an empty list", () => {
    expect(() => assignTier(tiers, catalog, "banana", ["deepseek-flash"])).toThrow(/unknown tier/);
    expect(() => assignTier(tiers, catalog, "main", ["no-such-model"])).toThrow(/does not have/);
    expect(() => assignTier(tiers, catalog, "main", [])).toThrow(/at least one/);
  });
});

describe("describeTiers", () => {
  test("lists each tier's models in order, then the catalog", () => {
    const out = describeTiers(tiers, catalog);
    expect(out).toContain("deterministic  qwen3.8-27b-linux → qwen3.8-27b-mac");
    expect(out).toContain("catalog: deepseek-flash, deepseek-v4-pro");
  });
});
