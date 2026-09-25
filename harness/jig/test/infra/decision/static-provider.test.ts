import { describe, expect, test } from "bun:test";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

describe("StaticProvider", () => {
  test("returns the configured choice when it is a valid option", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.8 } });
    const decided = await provider.choice({ prompt: "?", options: ["main", "complex"] }, {});
    expect(decided).toEqual({ value: "complex", confidence: 0.8 });
  });

  test("throws when the configured choice is not among the options", async () => {
    const provider = new StaticProvider({ choice: { value: "nope", confidence: 1 } });
    await expect(provider.choice({ prompt: "?", options: ["main"] }, {})).rejects.toThrow(
      /not in options/,
    );
  });

  test("throws when the queried kind was not configured", async () => {
    const provider = new StaticProvider({});
    await expect(provider.bool({ prompt: "?" }, {})).rejects.toThrow(/no bool answer/);
  });

  test("returns configured bool and score", async () => {
    const provider = new StaticProvider({
      bool: { value: true, confidence: 0.95 },
      score: { value: 0.3, confidence: 0.5 },
    });
    expect(await provider.bool({ prompt: "?" }, {})).toEqual({ value: true, confidence: 0.95 });
    expect(await provider.score({ prompt: "?" }, {})).toEqual({ value: 0.3, confidence: 0.5 });
  });

  test("batch answers come back in the order they were asked", async () => {
    const provider = new StaticProvider({
      bools: [
        { value: true, confidence: 0.9 },
        { value: false, confidence: 0.8 },
      ],
    });

    expect(await provider.boolBatch({ material: "m", prompts: ["a", "b"] }, {})).toEqual([
      { value: true, confidence: 0.9 },
      { value: false, confidence: 0.8 },
    ]);
  });

  test("without batch answers the single bool answer is reused for every question", async () => {
    const provider = new StaticProvider({ bool: { value: true, confidence: 0.95 } });

    expect(await provider.boolBatch({ material: "m", prompts: ["a", "b", "c"] }, {})).toEqual([
      { value: true, confidence: 0.95 },
      { value: true, confidence: 0.95 },
      { value: true, confidence: 0.95 },
    ]);
  });

  test("a batch answer count that does not match the prompts is an error", async () => {
    const provider = new StaticProvider({ bools: [{ value: true, confidence: 1 }] });

    await expect(provider.boolBatch({ material: "m", prompts: ["a", "b"] }, {})).rejects.toThrow(
      /1 batch answers for 2 prompts/,
    );
  });
});
