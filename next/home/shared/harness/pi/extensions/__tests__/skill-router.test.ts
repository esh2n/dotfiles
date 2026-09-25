import { describe, expect, test } from "bun:test";
import { type SkillDecision, readSkillDecision, reminderFor } from "../skill-router";

describe("readSkillDecision", () => {
  test("reads a skill answer", () => {
    expect(
      readSkillDecision({
        skill: "cost-tracking",
        path: "/skills/cost-tracking/SKILL.md",
        confidence: 1,
        source: "decided",
      }),
    ).toEqual<SkillDecision>({
      skill: "cost-tracking",
      path: "/skills/cost-tracking/SKILL.md",
      confidence: 1,
      source: "decided",
    });
  });

  test("reads a `null` answer: nothing applies", () => {
    const decision = readSkillDecision({
      skill: null,
      path: null,
      confidence: 0.99,
      source: "decided",
    });
    expect(decision.skill).toBeNull();
    expect(reminderFor(decision)).toBeUndefined();
  });

  test("refuses a reply it cannot trust", () => {
    for (const body of [
      undefined,
      {},
      { skill: 1, path: null, confidence: 1, source: "decided" },
      { skill: "x", path: null, confidence: "1", source: "decided" },
      { skill: "x", path: null, confidence: 1, source: "maybe" },
    ]) {
      expect(() => readSkillDecision(body)).toThrow();
    }
  });
});

describe("reminderFor", () => {
  test("points at the body instead of carrying it", () => {
    const reminder = reminderFor({
      skill: "writeup",
      path: "/skills/writeup/SKILL.md",
      confidence: 0.93,
      source: "decided",
    });

    expect(reminder).toContain('"writeup"');
    expect(reminder).toContain("0.93");
    expect(reminder).toContain("/skills/writeup/SKILL.md");
  });

  test("a name without a path is not injectable", () => {
    // The path is the whole point: the body is what the model needs, and the router
    // never carries it.
    expect(
      reminderFor({ skill: "writeup", path: null, confidence: 0.93, source: "decided" }),
    ).toBeUndefined();
  });
});
