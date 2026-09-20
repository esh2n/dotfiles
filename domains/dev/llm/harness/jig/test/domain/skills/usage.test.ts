import { describe, expect, it } from "bun:test";
import {
  type SkillTurn,
  skillNameFromPath,
  summarizeSkillUsage,
} from "../../../src/domain/skills/usage";

describe("skillNameFromPath", () => {
  it("names the skill in the repo's profile layout", () => {
    expect(
      skillNameFromPath("/repo/domains/dev/config/claude-profiles/core/skills/grilling/SKILL.md"),
    ).toBe("grilling");
  });

  it("names the skill in the merged farm", () => {
    expect(skillNameFromPath("/Users/x/.claude/.skills-merged/writeup/SKILL.md")).toBe("writeup");
  });

  it("names the skill for a reference file read below the body", () => {
    expect(skillNameFromPath("/Users/x/.claude/.skills-merged/writeup/references/css.md")).toBe(
      "writeup",
    );
  });

  it("takes the rightmost marker, so a nested farm path does not shadow the skill", () => {
    expect(skillNameFromPath("/repo/skills/archive/.skills-merged/go-modern/SKILL.md")).toBe(
      "go-modern",
    );
  });

  it("names a body with no marker segment after its directory", () => {
    expect(skillNameFromPath("/tmp/copy/go-modern/SKILL.md")).toBe("go-modern");
  });

  it("does not name a file that merely sits in a directory called skills", () => {
    // jig's own source tree has `infra/skills/`, and the model reads it while working on
    // the router. The catalog filter is the backstop; this rule does not even offer it.
    expect(skillNameFromPath("/repo/jig/src/infra/skills/catalog.ts")).toBeUndefined();
  });

  it("returns undefined for a path that names no skill", () => {
    expect(skillNameFromPath("/repo/jig/src/cli/jig.ts")).toBeUndefined();
    expect(skillNameFromPath("")).toBeUndefined();
  });
});

function turn(overrides: Partial<SkillTurn> = {}): SkillTurn {
  return {
    session: "/sessions/a.jsonl",
    harness: "pi",
    at: "2026-09-20T00:00:00.000Z",
    injected: [],
    confidence: undefined,
    read: [],
    ...overrides,
  };
}

describe("summarizeSkillUsage", () => {
  it("classifies every turn exactly once", () => {
    const report = summarizeSkillUsage([
      turn({ injected: ["writeup"], read: ["writeup"] }),
      turn({ injected: ["writeup"], read: [] }),
      turn({ injected: ["writeup"], read: ["go-modern"] }),
      turn({ injected: [], read: ["go-modern"] }),
      turn({ injected: [], read: [] }),
    ]);

    expect(report.totals).toEqual({
      turns: 5,
      followed: 1,
      partial: 0,
      ignored: 1,
      substituted: 1,
      unrouted: 1,
      silent: 1,
    });
  });

  it("counts a skill the model opened several times in one turn once", () => {
    const report = summarizeSkillUsage([turn({ injected: [], read: ["writeup", "writeup"] })]);
    const row = report.skills.find((skill) => skill.skill === "writeup");
    expect(row?.opened).toBe(1);
  });

  it("splits each skill into injected, opened, followed and unscouted", () => {
    const report = summarizeSkillUsage([
      turn({ injected: ["writeup"], read: ["writeup"] }),
      turn({ injected: ["writeup"], read: [] }),
      turn({ injected: [], read: ["writeup"] }),
    ]);

    expect(report.skills).toEqual([
      { skill: "writeup", injected: 2, opened: 2, followed: 1, unrouted: 1 },
    ]);
  });

  it("keeps per-harness totals that add up to the whole", () => {
    const report = summarizeSkillUsage([
      turn({ harness: "pi", injected: ["writeup"], read: ["writeup"] }),
      turn({ harness: "claude", injected: [], read: [] }),
      turn({ harness: "unknown", injected: [], read: ["go-modern"] }),
    ]);

    expect(report.byHarness.get("pi")?.turns).toBe(1);
    expect(report.byHarness.get("claude")?.silent).toBe(1);
    expect(report.byHarness.get("unknown")?.unrouted).toBe(1);
  });

  it("sorts skills by opened, then by name", () => {
    const report = summarizeSkillUsage([
      turn({ read: ["beta"] }),
      turn({ read: ["alpha", "beta"] }),
    ]);
    expect(report.skills.map((skill) => skill.skill)).toEqual(["beta", "alpha"]);
  });

  it("reports an empty window without inventing a rate", () => {
    const report = summarizeSkillUsage([]);
    expect(report.totals.turns).toBe(0);
    expect(report.skills).toEqual([]);
    expect(report.from).toBe("");
  });
});
