import { describe, expect, test } from "bun:test";
import { type Decided, gate } from "../../../src/domain/decision/provider";

const decided = <T>(value: T, confidence: number): Decided<T> => ({ value, confidence });

describe("gate", () => {
  test("keeps the decided value when confidence meets the threshold", () => {
    expect(gate(decided("complex", 0.9), 0.7, "main")).toEqual({
      value: "complex",
      confidence: 0.9,
      source: "decided",
    });
  });

  test("uses the fallback when confidence is below the threshold", () => {
    expect(gate(decided("complex", 0.4), 0.7, "main")).toEqual({
      value: "main",
      confidence: 0.4,
      source: "fallback",
    });
  });

  test("treats confidence exactly at the threshold as decided", () => {
    expect(gate(decided(true, 0.7), 0.7, false).source).toBe("decided");
  });

  test("carries the original confidence through even on fallback", () => {
    expect(gate(decided(0.2, 0.1), 0.5, 0).confidence).toBe(0.1);
  });
});
