import { describe, expect, test } from "bun:test";
import { resolvePluginsDir, resolveSkillRoot } from "../../../src/app/hooks/environment";

describe("resolveSkillRoot", () => {
  test("defaults to ~/.claude/skills", () => {
    expect(resolveSkillRoot({}, "/home/u")).toBe("/home/u/.claude/skills");
  });

  test("follows CLAUDE_CONFIG_DIR, the directory Claude Code itself loads skills from", () => {
    expect(resolveSkillRoot({ CLAUDE_CONFIG_DIR: "/home/u/.cc" }, "/home/u")).toBe(
      "/home/u/.cc/skills",
    );
  });

  test("JIG_SKILL_ROOT wins over both", () => {
    expect(resolveSkillRoot({ JIG_SKILL_ROOT: "/x", CLAUDE_CONFIG_DIR: "/y" }, "/home/u")).toBe(
      "/x",
    );
  });
});

describe("resolvePluginsDir", () => {
  test("defaults to ~/.local/share/jig/plugins", () => {
    expect(resolvePluginsDir({}, "/home/u")).toBe("/home/u/.local/share/jig/plugins");
  });

  test("follows XDG_DATA_HOME, the same rule dotctl setup plugins uses", () => {
    expect(resolvePluginsDir({ XDG_DATA_HOME: "/data" }, "/home/u")).toBe("/data/jig/plugins");
  });

  test("JIG_PLUGINS_DIR wins", () => {
    expect(resolvePluginsDir({ JIG_PLUGINS_DIR: "/p", XDG_DATA_HOME: "/data" }, "/home/u")).toBe(
      "/p",
    );
  });
});
