import { describe, expect, test } from "bun:test";
import { backupPath, planDirectory, planLink } from "../../../src/domain/claude/links";

const PATH = "/home/u/.claude/skills";
const TARGET = "/repo/llm/harness/skills";

describe("planLink: what stands at the path decides the state", () => {
  test("nothing there: create", () => {
    expect(planLink(PATH, TARGET, { kind: "missing" })).toEqual({
      path: PATH,
      target: TARGET,
      state: "create",
    });
  });

  test("already the planned link: ok", () => {
    expect(planLink(PATH, TARGET, { kind: "symlink", target: TARGET }).state).toBe("ok");
  });

  test("a symlink elsewhere (today: yoki-switch's staging dir): replace, and the old target is reported", () => {
    const plan = planLink(PATH, TARGET, {
      kind: "symlink",
      target: "/home/u/.claude/.skills-merged",
    });
    expect(plan).toEqual({
      path: PATH,
      target: TARGET,
      state: "replace",
      previousTarget: "/home/u/.claude/.skills-merged",
    });
  });

  test("target comparison is literal: a relative and an absolute spelling are different links", () => {
    const claudeMd = "/home/u/.claude/CLAUDE.md";
    expect(planLink(claudeMd, "AGENTS.md", { kind: "symlink", target: "AGENTS.md" }).state).toBe(
      "ok",
    );
    expect(
      planLink(claudeMd, "AGENTS.md", { kind: "symlink", target: "/home/u/.claude/AGENTS.md" })
        .state,
    ).toBe("replace");
  });

  test("a regular file (today: CLAUDE.md) or a real directory: backup-then-create, never delete", () => {
    expect(planLink(PATH, TARGET, { kind: "file" }).state).toBe("backup-then-create");
    expect(planLink(PATH, TARGET, { kind: "dir" }).state).toBe("backup-then-create");
  });
});

describe("planDirectory: the rules directory must be a real directory", () => {
  test("a real directory is ok; missing is create", () => {
    expect(planDirectory("/d", { kind: "dir" }).state).toBe("ok");
    expect(planDirectory("/d", { kind: "missing" }).state).toBe("create");
  });

  test("a symlink (today: → .rules-merged) is replaced, the target left alone", () => {
    const plan = planDirectory("/d", { kind: "symlink", target: "/home/u/.claude/.rules-merged" });
    expect(plan.state).toBe("replace");
    expect(plan.previousTarget).toBe("/home/u/.claude/.rules-merged");
  });

  test("a file in the way is renamed aside", () => {
    expect(planDirectory("/d", { kind: "file" }).state).toBe("backup-then-create");
  });
});

describe("backupPath", () => {
  test("appends .pre-jig.<YYYYMMDD-HHMMSS> in UTC", () => {
    expect(backupPath("/home/u/.claude/CLAUDE.md", new Date("2026-09-23T04:05:06.789Z"))).toBe(
      "/home/u/.claude/CLAUDE.md.pre-jig.20260923-040506",
    );
  });
});
