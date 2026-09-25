/**
 * Mutation check: a change to the canonical tiers.json must actually flow
 * through to every writer that can express the changed field — otherwise a
 * writer is reading stale data or ignoring its input, and the golden tests
 * alone wouldn't catch that (they only prove the CURRENT document round
 * trips; they don't prove the writer is wired to its argument at all).
 */

import { describe, expect, test } from "bun:test";
import type { TiersPolicy } from "../../../src/domain/tiers/types";
import { toDshModelsBlock } from "../../../src/domain/tiers/write-dsh";
import { toPiModels } from "../../../src/domain/tiers/write-pi";
import { loadRealTiers } from "./fixtures";

function withMainMaxTokens(policy: TiersPolicy, maxTokens: number): TiersPolicy {
  return {
    ...policy,
    tiers: {
      ...policy.tiers,
      main: { ...policy.tiers.main, maxTokens },
    },
  };
}

function withMainDshName(policy: TiersPolicy, name: string): TiersPolicy {
  return {
    ...policy,
    tiers: {
      ...policy.tiers,
      main: { ...policy.tiers.main, dsh: { ...policy.tiers.main.dsh, name } },
    },
  };
}

describe("mutating a tier flows through to every writer that can express it", () => {
  test("main.maxTokens changes pi's output", () => {
    const base = loadRealTiers();
    const mutated = withMainMaxTokens(base, 99999);

    expect(toPiModels(base).content).not.toBe(toPiModels(mutated).content);
    expect(toPiModels(mutated).content).toContain('"maxTokens": 99999');
  });

  test("main.dsh.name changes dsh's block, not pi's output", () => {
    const base = loadRealTiers();
    const mutated = withMainDshName(base, "main (renamed)");

    expect(toDshModelsBlock(base).content).not.toBe(toDshModelsBlock(mutated).content);
    expect(toDshModelsBlock(mutated).content).toContain("name: main (renamed)");
    // pi has its own presentation string (pi.name) and never reads dsh.name.
    expect(toPiModels(base).content).toBe(toPiModels(mutated).content);
  });

  test("main.maxTokens does NOT change dsh's block (dsh's schema can't express it)", () => {
    const base = loadRealTiers();
    const mutated = withMainMaxTokens(base, 99999);

    expect(toDshModelsBlock(base).content).toBe(toDshModelsBlock(mutated).content);
  });
});
