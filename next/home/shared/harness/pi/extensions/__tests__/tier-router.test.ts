import { describe, expect, test } from "bun:test";
import { initialMode, isTier } from "../tier-router";

describe("isTier", () => {
  test("accepts the three LiteLLM tiers and nothing else", () => {
    expect(isTier("main")).toBe(true);
    expect(isTier("complex")).toBe(true);
    expect(isTier("deterministic")).toBe(true);
    expect(isTier("auto")).toBe(false);
    expect(isTier("")).toBe(false);
    expect(isTier(undefined)).toBe(false);
  });
});

describe("initialMode (the session's tier at launch)", () => {
  test("main unless PI_TIER names another tier", () => {
    expect(initialMode({})).toBe("main");
    expect(initialMode({ PI_TIER: "complex" })).toBe("complex");
    expect(initialMode({ PI_TIER: "deterministic" })).toBe("deterministic");
  });
  test("off stops enforcing; an unknown value falls back to main, never to automatic routing", () => {
    expect(initialMode({ PI_TIER: "off" })).toBe("off");
    expect(initialMode({ PI_TIER: "auto" })).toBe("main");
    expect(initialMode({ PI_TIER: "turbo" })).toBe("main");
  });
});
