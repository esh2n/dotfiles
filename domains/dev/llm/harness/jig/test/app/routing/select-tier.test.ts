import { describe, expect, test } from "bun:test";
import { type Tier, selectTier, tierMaterial } from "../../../src/app/routing/select-tier";
import type {
  ChoiceQuery,
  Decided,
  DecisionContext,
  DecisionProvider,
} from "../../../src/domain/decision/provider";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

/** Answers a tier and records the prompt it was asked, to check what the model sees. */
class PromptRecordingProvider implements DecisionProvider {
  readonly name = "prompt-recorder";
  prompts: string[] = [];

  constructor(private readonly answer: Tier) {}

  async choice<T extends string>(
    query: ChoiceQuery<T>,
    _context: DecisionContext,
  ): Promise<Decided<T>> {
    this.prompts.push(query.prompt);
    if (query.options.includes(this.answer as T) === false) {
      throw new Error(`no option matches ${this.answer}`);
    }
    return { value: this.answer as T, confidence: 0.9 };
  }

  async bool(): Promise<Decided<boolean>> {
    throw new Error("selectTier must ask one choice question");
  }

  async boolBatch(): Promise<readonly Decided<boolean>[]> {
    throw new Error("selectTier must ask one choice question");
  }

  async score(): Promise<Decided<number>> {
    throw new Error("selectTier must ask one choice question");
  }
}

describe("tierMaterial", () => {
  test("a short request is sent as it is", () => {
    expect(tierMaterial("rename a variable")).toBe("rename a variable");
  });

  test("a long request keeps both ends and announces the elision", () => {
    const request = `START ${"x".repeat(9_000)} MIDDLE_MARKER ${"y".repeat(9_000)} ASK`;

    const material = tierMaterial(request);

    expect(material.startsWith("START ")).toBe(true);
    expect(material.endsWith(" ASK")).toBe(true);
    expect(material).toContain("characters elided from the middle");
    // The only thing that goes is the middle.
    expect(material).not.toContain("MIDDLE_MARKER");
    // Bounded to the two windows plus the one-line marker and its separators.
    expect(material.length).toBeLessThan(4_200);
  });

  test("the middle is the part that goes, not the ask at the end", () => {
    const request = `${"a".repeat(5_000)} the real question at the end?`;
    expect(tierMaterial(request).endsWith(" the real question at the end?")).toBe(true);
  });
});

describe("selectTier", () => {
  test("routes to the decided tier when confidence clears the gate", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.9 } });
    const result = await selectTier("prove a theorem", provider);
    expect(result).toEqual({ value: "complex", confidence: 0.9, source: "decided" });
  });

  test("asks about the bounded material, not the whole request", async () => {
    const provider = new PromptRecordingProvider("complex");

    await selectTier(`${"y".repeat(50_000)} final ask`, provider);

    const prompt = provider.prompts[0] ?? "";
    expect(prompt.startsWith("Which tier fits this request?")).toBe(true);
    expect(prompt.length).toBeLessThan(4_300);
    expect(prompt).toContain("characters elided from the middle");
    expect(prompt.endsWith(" final ask")).toBe(true);
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
