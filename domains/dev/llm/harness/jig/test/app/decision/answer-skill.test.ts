import { describe, expect, test } from "bun:test";
import { type SkillDecision, answerSkill } from "../../../src/app/decision/answer-skill";
import type { SkillCandidate } from "../../../src/app/routing/select-skill";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

const catalog: readonly SkillCandidate[] = [
  {
    name: "ui-capture",
    description: "screenshots of a web UI",
    path: "/skills/ui-capture/SKILL.md",
  },
  { name: "writeup", description: "documents that are kept", path: "/skills/writeup/SKILL.md" },
];

const readCatalog = async () => catalog;

describe("answerSkill", () => {
  test("answers with the skill and its path", async () => {
    const result = await answerSkill(
      { prompt: "このページのスクショを撮って" },
      new StaticProvider({
        choice: { value: "ui-capture", confidence: 0.96 },
      }),
      { catalog: readCatalog },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision).toEqual<SkillDecision>({
      skill: "ui-capture",
      path: "/skills/ui-capture/SKILL.md",
      confidence: 0.96,
      source: "decided",
    });
  });

  test("`null` is a real answer: no skill fits", async () => {
    const result = await answerSkill(
      { prompt: "今日の天気" },
      new StaticProvider({
        choice: { value: "none", confidence: 0.99 },
      }),
      { catalog: readCatalog },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.skill).toBeNull();
    expect(result.decision.path).toBeNull();
    // Decided, not fallback: the judgment was consulted and said nothing applies.
    expect(result.decision.source).toBe("decided");
  });

  test("a weak judgment is a `null` answer with source fallback", async () => {
    const result = await answerSkill(
      { prompt: "何か" },
      new StaticProvider({
        choice: { value: "writeup", confidence: 0.31 },
      }),
      { catalog: readCatalog },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.skill).toBeNull();
    expect(result.decision.source).toBe("fallback");
  });

  test("a malformed body is the caller's bug, not an upstream failure", async () => {
    const provider = new StaticProvider({});
    for (const body of [undefined, {}, { prompt: 42 }, { prompt: "   " }, []]) {
      const result = await answerSkill(body, provider, { catalog: readCatalog });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("bad-request");
    }
  });

  test("an unreadable catalog is an upstream failure, not an empty answer", async () => {
    const result = await answerSkill(
      { prompt: "スクショを撮って" },
      new StaticProvider({
        choice: { value: "ui-capture", confidence: 0.99 },
      }),
      {
        catalog: async () => {
          throw new Error("farm unreadable");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("provider-error");
    expect(result.message).toContain("unreadable");
  });
});
