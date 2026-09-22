import { describe, expect, test } from "bun:test";
import {
  NOT_RULE_DIRS,
  reconcileRulesDir,
  selectRuleDirs,
} from "../../../src/domain/claude/rules-dir";

const RULES_DIR = "/home/u/.claude/rules";
const HARNESS_RULES = "/repo/llm/harness/rules";

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

describe("reconcileRulesDir", () => {
  test("a planned directory with nothing at its path is created", () => {
    const actions = reconcileRulesDir({
      rulesDir: RULES_DIR,
      harnessRules: HARNESS_RULES,
      planned: ["go"],
      entries: [],
    });
    expect(actions).toEqual([
      {
        kind: "link",
        name: "go",
        plan: { path: `${RULES_DIR}/go`, target: `${HARNESS_RULES}/go`, state: "create" },
      },
    ]);
  });

  test("a link that is already right is ok; one pointing elsewhere is replaced", () => {
    const actions = reconcileRulesDir({
      rulesDir: RULES_DIR,
      harnessRules: HARNESS_RULES,
      planned: ["go", "python"],
      entries: [
        { name: "go", state: { kind: "symlink", target: `${HARNESS_RULES}/go` } },
        { name: "python", state: { kind: "symlink", target: "/old/packs/python/rules/python" } },
      ],
    });
    expect(actions.map((a) => (a.kind === "link" ? a.plan.state : a.kind))).toEqual([
      "ok",
      "replace",
    ]);
  });

  test("a jig link that is no longer planned is stale and removed", () => {
    const actions = reconcileRulesDir({
      rulesDir: RULES_DIR,
      harnessRules: HARNESS_RULES,
      planned: ["go"],
      entries: [{ name: "rust", state: { kind: "symlink", target: `${HARNESS_RULES}/rust` } }],
    });
    expect(actions[1]).toEqual({
      kind: "stale",
      name: "rust",
      path: `${RULES_DIR}/rust`,
      target: `${HARNESS_RULES}/rust`,
    });
  });

  test("anything not jig's — a user's file, a link elsewhere, a real directory — is left alone and named", () => {
    const actions = reconcileRulesDir({
      rulesDir: RULES_DIR,
      harnessRules: HARNESS_RULES,
      planned: [],
      entries: [
        { name: "mine.md", state: { kind: "file" } },
        { name: "elsewhere", state: { kind: "symlink", target: "/somewhere/else" } },
        { name: "real", state: { kind: "dir" } },
      ],
    });
    expect(actions.map((a) => a.kind)).toEqual(["foreign", "foreign", "foreign"]);
    expect(actions.map((a) => (a.kind === "foreign" ? a.what : ""))).toEqual([
      "a symlink → /somewhere/else",
      "a regular file",
      "a directory",
    ]);
  });

  test("a stale link is one INTO the harness's rules/, not merely one jig would not make: the prefix is the whole test", () => {
    const actions = reconcileRulesDir({
      rulesDir: RULES_DIR,
      harnessRules: HARNESS_RULES,
      planned: [],
      entries: [
        { name: "a", state: { kind: "symlink", target: `${HARNESS_RULES}-other/a` } },
        { name: "b", state: { kind: "symlink", target: `${HARNESS_RULES}/common` } },
      ],
    });
    expect(actions.map((a) => `${a.name}:${a.kind}`)).toEqual(["b:stale", "a:foreign"]);
  });
});
