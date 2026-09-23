import { describe, expect, test } from "bun:test";
import { NOT_RULE_DIRS, selectRuleDirs } from "../../../src/domain/claude/rules-dir";

describe("selectRuleDirs", () => {
  test("common, decisions and research are never linked, and each says why", () => {
    const { linked, excluded } = selectRuleDirs([
      "typescript",
      "common",
      "decisions",
      "research",
      "go",
    ]);
    expect(linked).toEqual(["go", "typescript"]);
    expect(excluded.map((e) => e.name)).toEqual(["common", "decisions", "research"]);
    expect(excluded[0]?.reason).toContain("AGENTS.md");
    expect(excluded[1]?.reason).toContain("always-on");
  });

  test("the exclusion list is exactly those three", () => {
    expect([...NOT_RULE_DIRS].sort()).toEqual(["common", "decisions", "research"]);
  });

  test("only the excluded directories that are actually present are reported", () => {
    expect(selectRuleDirs(["common"]).excluded.map((e) => e.name)).toEqual(["common"]);
    expect(selectRuleDirs([]).excluded).toEqual([]);
  });
});
