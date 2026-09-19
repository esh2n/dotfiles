import { describe, expect, test } from "bun:test";
import { selectTier } from "../../../src/app/routing/select-tier";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

describe("selectTier", () => {
  test("routes to the decided tier when confidence clears the gate", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.9 } });
    const result = await selectTier("prove a theorem", provider);
    expect(result).toEqual({ value: "complex", confidence: 0.9, source: "decided" });
  });

  test("falls back to main when confidence is low", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.3 } });
    const result = await selectTier("rename a variable", provider);
    expect(result.value).toBe("main");
    expect(result.source).toBe("fallback");
  });

  test("honors a custom threshold and fallback", async () => {
    const provider = new StaticProvider({ choice: { value: "deterministic", confidence: 0.55 } });
    const result = await selectTier(
      "format json",
      provider,
      {},
      { threshold: 0.5, fallback: "main" },
    );
    expect(result).toEqual({ value: "deterministic", confidence: 0.55, source: "decided" });
  });
});
