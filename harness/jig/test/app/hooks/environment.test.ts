import { describe, expect, test } from "bun:test";
import {
  resolveRulesProfile,
  resolveRulesProfileFor,
  resolveSkillRoot,
} from "../../../src/app/hooks/environment";

describe("resolveSkillRoot", () => {
  test("defaults to the skills directory of ~/.claude", () => {
    expect(resolveSkillRoot({}, "/home/u")).toBe("/home/u/.claude/skills");
  });

  test("follows CLAUDE_CONFIG_DIR: a session in another configuration directory sees that directory's skills", () => {
    expect(resolveSkillRoot({ CLAUDE_CONFIG_DIR: "/home/u/.claude-pstack" }, "/home/u")).toBe(
      "/home/u/.claude-pstack/skills",
    );
  });

  test("JIG_SKILL_ROOT overrides both", () => {
    expect(
      resolveSkillRoot({ CLAUDE_CONFIG_DIR: "/x", JIG_SKILL_ROOT: "/tmp/skills" }, "/home/u"),
    ).toBe("/tmp/skills");
  });
});

describe("resolveRulesProfile", () => {
  test("unset or blank is the default rule set", () => {
    expect(resolveRulesProfile({})).toBeUndefined();
    expect(resolveRulesProfile({ JIG_PROFILE: "  " })).toBeUndefined();
  });

  test("a name selects harness/profiles/<name>", () => {
    expect(resolveRulesProfile({ JIG_PROFILE: "pstack" })).toBe("pstack");
  });

  test("a profile renders only into a second Claude configuration directory", () => {
    const env = { JIG_PROFILE: "pstack", CLAUDE_CONFIG_DIR: "/home/u/.claude-pstack" };
    expect(resolveRulesProfileFor(env, "claude")).toBe("pstack");
    expect(resolveRulesProfileFor({}, "codex")).toBeUndefined();
    expect(() => resolveRulesProfileFor({ JIG_PROFILE: "pstack" }, "claude")).toThrow(
      "needs CLAUDE_CONFIG_DIR",
    );
    for (const target of ["codex", "omp", "pi", "dsh", "all"]) {
      expect(() => resolveRulesProfileFor(env, target)).toThrow("applies only to --target claude");
    }
  });

  test("anything but a plain directory name is refused: it would read rules from outside harness/profiles/", () => {
    for (const bad of ["../../tmp/evil", "/etc", "p stack", "Pstack", "a/b"]) {
      expect(() => resolveRulesProfile({ JIG_PROFILE: bad })).toThrow("not a profile name");
    }
  });
});
