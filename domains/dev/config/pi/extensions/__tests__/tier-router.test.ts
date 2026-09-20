import { describe, expect, test } from "bun:test";
import { readDecision } from "../tier-router";

describe("readDecision", () => {
  test("a valid tier reply is read with its confidence and source", () => {
    const decision = readDecision({ tier: "complex", confidence: 0.87, source: "decided" });
    expect(decision).toEqual({ tier: "complex", confidence: 0.87, source: "decided" });
  });

  test("confidence defaults to 0 when missing or the wrong type", () => {
    expect(readDecision({ tier: "main" })).toEqual({
      tier: "main",
      confidence: 0,
      source: "fallback",
    });
    expect(readDecision({ tier: "main", confidence: "high" })).toEqual({
      tier: "main",
      confidence: 0,
      source: "fallback",
    });
  });

  test("source defaults to fallback for anything but the literal 'decided'", () => {
    expect(readDecision({ tier: "main", source: "guessed" })).toEqual({
      tier: "main",
      confidence: 0,
      source: "fallback",
    });
  });

  test("an invalid tier throws, quoting the error message from an error-shaped body", () => {
    expect(() =>
      readDecision({ error: { message: "no judgment available" } }),
    ).toThrow("no judgment available");
  });

  test("an invalid tier with no error body throws a generic message", () => {
    expect(() => readDecision({ tier: "bogus-tier" })).toThrow(/no tier in the reply/);
  });

  test("a non-object body throws", () => {
    expect(() => readDecision(null)).toThrow("tier service replied with no body");
    expect(() => readDecision("nope")).toThrow("tier service replied with no body");
  });

  test("a malformed error body (not an object) falls back to the generic message", () => {
    expect(() => readDecision({ error: "boom" })).toThrow(/no tier in the reply/);
  });
});
