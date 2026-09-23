import { describe, expect, test } from "bun:test";
import { selectSkillDirs } from "../../../src/domain/claude/skills-dir";

describe("selectSkillDirs", () => {
  test("a directory holding SKILL.md is a skill; README.md and a directory without one are not, and say why", () => {
    const { linked, excluded } = selectSkillDirs([
      { name: "writeup", state: { kind: "dir" }, hasSkillMd: true },
      { name: "README.md", state: { kind: "file" }, hasSkillMd: false },
      { name: "archive", state: { kind: "dir" }, hasSkillMd: false },
      { name: "eli5", state: { kind: "dir" }, hasSkillMd: true },
    ]);
    expect(linked).toEqual(["eli5", "writeup"]);
    expect(excluded).toEqual([
      { name: "README.md", reason: "a file, not a skill directory" },
      { name: "archive", reason: "no SKILL.md inside, so not a skill" },
    ]);
  });

  test("a source entry that is itself a symlink to a skill directory counts: SKILL.md decides", () => {
    const { linked } = selectSkillDirs([
      {
        name: "vendored",
        state: { kind: "symlink", target: "/elsewhere/vendored" },
        hasSkillMd: true,
      },
    ]);
    expect(linked).toEqual(["vendored"]);
  });

  test("an empty source is an empty selection", () => {
    expect(selectSkillDirs([])).toEqual({ linked: [], excluded: [] });
  });
});
