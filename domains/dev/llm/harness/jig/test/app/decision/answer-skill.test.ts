import { describe, expect, test } from "bun:test";
import { type SkillDecision, answerSkill } from "../../../src/app/decision/answer-skill";
import type { SkillCandidate } from "../../../src/domain/skills/candidate";
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

/** One answer per candidate, in catalog order, for the batch the use-case asks. */
function provider(answer: readonly [boolean, number]): StaticProvider {
  return new StaticProvider({
    bools: catalog.map(() => ({ value: answer[0], confidence: answer[1] })),
  });
}

/** Per-candidate answers by name, so a test states which skills the judgment names. */
function providerFor(
  answers: Readonly<Record<string, readonly [boolean, number]>>,
): StaticProvider {
  return new StaticProvider({
    bools: catalog.map((candidate) => {
      const [value, confidence] = answers[candidate.name] ?? [false, 1];
      return { value, confidence };
    }),
  });
}

describe("answerSkill", () => {
  test("answers with each picked skill, its path and its confidence", async () => {
    const result = await answerSkill(
      { prompt: "このページのスクショを撮って" },
      providerFor({ "ui-capture": [true, 0.96] }),
      { catalog: readCatalog },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision).toEqual<SkillDecision>({
      skills: [{ name: "ui-capture", path: "/skills/ui-capture/SKILL.md", confidence: 0.96 }],
      passed: 1,
      source: "decided",
    });
  });

  test("answers with several skills, strongest first", async () => {
    const result = await answerSkill(
      { prompt: "この設計をレビューして。Goの性能も見て" },
      providerFor({ "ui-capture": [true, 0.81], writeup: [true, 0.95] }),
      { catalog: readCatalog },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.skills.map((pick) => pick.name)).toEqual(["writeup", "ui-capture"]);
    expect(result.decision.source).toBe("decided");
  });

  test("an empty list is a real answer: no skill fits", async () => {
    const result = await answerSkill({ prompt: "今日の天気" }, providerFor({}), {
      catalog: readCatalog,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.skills).toEqual([]);
    // Decided, not fallback: the judgment was consulted and said nothing applies.
    expect(result.decision.source).toBe("decided");
  });

  test("a weak judgment is an empty answer with source fallback", async () => {
    const result = await answerSkill({ prompt: "何か" }, providerFor({ writeup: [true, 0.31] }), {
      catalog: readCatalog,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.skills).toEqual([]);
    expect(result.decision.source).toBe("fallback");
  });

  test("reports how many cleared the gate, so a batch that says yes to everything shows", async () => {
    const result = await answerSkill({ prompt: "何か" }, provider([true, 0.99]), {
      catalog: readCatalog,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both candidates passed and both are handed over; `passed` is how a caller can see
    // that the judgment was not choosing between them.
    expect(result.decision.skills).toHaveLength(2);
    expect(result.decision.passed).toBe(2);
  });

  test("a malformed body is the caller's bug, not an upstream failure", async () => {
    const unused = new StaticProvider({});
    for (const body of [undefined, {}, { prompt: 42 }, { prompt: "   " }, []]) {
      const result = await answerSkill(body, unused, { catalog: readCatalog });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("bad-request");
    }
  });

  test("an unreadable catalog is an upstream failure, not an empty answer", async () => {
    const result = await answerSkill(
      { prompt: "スクショを撮って" },
      providerFor({ "ui-capture": [true, 0.99] }),
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
