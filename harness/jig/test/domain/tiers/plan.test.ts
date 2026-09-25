import { describe, expect, test } from "bun:test";
import { planApply } from "../../../src/domain/tiers/plan";

const sha256 = (s: string) => `hash(${s})`; // fake, deterministic, injectable hash for these pure tests

describe("planApply", () => {
  test("dest doesn't exist yet: create", () => {
    const plan = planApply({
      currentContent: undefined,
      generatedContent: "new",
      manifestHash: undefined,
      sha256,
    });
    expect(plan.action).toBe("write");
  });

  test("no manifest entry (first run for this dest), content differs: write", () => {
    const plan = planApply({
      currentContent: "old",
      generatedContent: "new",
      manifestHash: undefined,
      sha256,
    });
    expect(plan.action).toBe("write");
  });

  test("no manifest entry, content already matches generated: noop", () => {
    const plan = planApply({
      currentContent: "same",
      generatedContent: "same",
      manifestHash: undefined,
      sha256,
    });
    expect(plan.action).toBe("noop");
  });

  test("manifest matches current (no hand edit), generated differs: write", () => {
    const plan = planApply({
      currentContent: "old",
      generatedContent: "new",
      manifestHash: sha256("old"),
      sha256,
    });
    expect(plan.action).toBe("write");
  });

  test("manifest matches current, generated also matches: noop", () => {
    const plan = planApply({
      currentContent: "same",
      generatedContent: "same",
      manifestHash: sha256("same"),
      sha256,
    });
    expect(plan.action).toBe("noop");
  });

  test("hand-edited (manifest mismatch) but current already equals generated: noop, no conflict", () => {
    const plan = planApply({
      currentContent: "hand-edited-to-match",
      generatedContent: "hand-edited-to-match",
      manifestHash: sha256("old-generated"),
      sha256,
    });
    expect(plan.action).toBe("noop");
  });

  test("hand-edited AND differs from generated: conflict, write nothing", () => {
    const plan = planApply({
      currentContent: "hand-edited",
      generatedContent: "new-generated",
      manifestHash: sha256("old-generated"),
      sha256,
    });
    expect(plan.action).toBe("conflict");
  });
});
