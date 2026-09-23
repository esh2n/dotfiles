import { describe, expect, test } from "bun:test";
import { codexPortTarget, selectCodexSkillPorts } from "../../../src/domain/codex/skills";

describe("selectCodexSkillPorts", () => {
  test("only a skill with codex/SKILL.md gets a link; the rest are named with why", () => {
    const { linked, excluded } = selectCodexSkillPorts([
      { name: "writeup", state: { kind: "dir" }, hasSkillMd: true, hasCodexPort: false },
      { name: "grilling", state: { kind: "dir" }, hasSkillMd: true, hasCodexPort: true },
      { name: "README.md", state: { kind: "file" }, hasSkillMd: false, hasCodexPort: false },
      { name: "archive", state: { kind: "dir" }, hasSkillMd: false, hasCodexPort: false },
      {
        name: "code-graph-exploration",
        state: { kind: "dir" },
        hasSkillMd: true,
        hasCodexPort: true,
      },
    ]);
    expect(linked).toEqual(["code-graph-exploration", "grilling"]);
    expect(excluded).toEqual([
      { name: "README.md", reason: "a file, not a skill directory" },
      { name: "archive", reason: "no SKILL.md inside, so not a skill" },
      { name: "writeup", reason: "no codex/SKILL.md — reaches Codex through ~/.agents/skills" },
    ]);
  });

  test("a codex/ directory under something that is not a skill does not make it one", () => {
    const { linked, excluded } = selectCodexSkillPorts([
      { name: "odd", state: { kind: "dir" }, hasSkillMd: false, hasCodexPort: true },
    ]);
    expect(linked).toEqual([]);
    expect(excluded[0]?.reason).toBe("no SKILL.md inside, so not a skill");
  });

  test("the link points at the port, not the skill root", () => {
    expect(codexPortTarget("/repo/llm/harness/skills", "grilling")).toBe(
      "/repo/llm/harness/skills/grilling/codex",
    );
  });
});
