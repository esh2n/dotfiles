import { describe, expect, test } from "bun:test";
import { type SkillDecision, readSkillDecision, reminderFor } from "../skill-router";

describe("readSkillDecision", () => {
  test("reads the service's batch answer", () => {
    expect(
      readSkillDecision({
        skills: [{ name: "cost-tracking", path: "/skills/cost-tracking/SKILL.md", confidence: 1 }],
        passed: 1,
        source: "decided",
      }),
    ).toEqual<SkillDecision>({
      skills: [{ name: "cost-tracking", path: "/skills/cost-tracking/SKILL.md", confidence: 1 }],
      passed: 1,
      source: "decided",
    });
  });

  test("reads an empty answer: nothing applies", () => {
    const decision = readSkillDecision({ skills: [], passed: 0, source: "decided" });
    expect(decision.skills).toEqual([]);
    expect(reminderFor(decision)).toBeUndefined();
  });

  test("refuses a reply it cannot trust", () => {
    for (const body of [
      undefined,
      {},
      { skills: "x", passed: 0, source: "decided" },
      { skills: [], passed: "0", source: "decided" },
      { skills: [], passed: 0, source: "maybe" },
      { skills: [{ name: "x", path: null, confidence: 1 }], passed: 1, source: "decided" },
      { skills: [{ name: "x", path: "/p", confidence: "1" }], passed: 1, source: "decided" },
    ]) {
      expect(() => readSkillDecision(body)).toThrow();
    }
  });
});

describe("reminderFor", () => {
  test("points at the bodies instead of carrying them", () => {
    const reminder = reminderFor({
      skills: [
        { name: "writeup", path: "/skills/writeup/SKILL.md", confidence: 0.93 },
        { name: "natural-japanese", path: "/skills/natural-japanese/SKILL.md", confidence: 0.81 },
      ],
      passed: 2,
      source: "decided",
    });
    expect(reminder).toContain("2 skills match");
    expect(reminder).toContain("0.93, 0.81");
    expect(reminder).toContain('- "writeup": /skills/writeup/SKILL.md');
    expect(reminder).toContain('- "natural-japanese": /skills/natural-japanese/SKILL.md');
  });

  test("one skill reads as one", () => {
    const reminder = reminderFor({
      skills: [{ name: "writeup", path: "/skills/writeup/SKILL.md", confidence: 0.93 }],
      passed: 1,
      source: "decided",
    });
    expect(reminder).toContain("1 skill matches");
  });
});
