/**
 * [live-verified] Loads the REAL canonical tier table —
 * `harness/policy/tiers.json` — and asserts it parses clean
 * and carries the three tiers every consumer expects. The writer golden
 * tests (write-pi/write-dsh/write-litellm) reuse the same real document
 * (`./fixtures.ts`) to regenerate each target's file.
 */

import { describe, expect, test } from "bun:test";
import { loadRealTiers } from "./fixtures";

describe("the real tiers.json", () => {
  test("parses clean", () => {
    expect(() => loadRealTiers()).not.toThrow();
  });

  test("carries exactly main/complex/deterministic", () => {
    const policy = loadRealTiers();
    expect(Object.keys(policy.tiers).sort()).toEqual(["complex", "deterministic", "main"]);
  });

  test("every alias matches its tier key", () => {
    const policy = loadRealTiers();
    for (const [id, tier] of Object.entries(policy.tiers)) {
      expect(tier.alias).toBe(id);
    }
  });
});
