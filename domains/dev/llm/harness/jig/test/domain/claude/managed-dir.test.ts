import { describe, expect, test } from "bun:test";
import { describePathState, reconcileManagedDir } from "../../../src/domain/claude/managed-dir";

const DIR = "/home/u/.claude/skills";
const SOURCE = "/repo/llm/harness/skills";

describe("reconcileManagedDir", () => {
  test("a planned entry with nothing at its path is created", () => {
    const actions = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: ["writeup"],
      entries: [],
    });
    expect(actions).toEqual([
      {
        kind: "link",
        name: "writeup",
        plan: { path: `${DIR}/writeup`, target: `${SOURCE}/writeup`, state: "create" },
      },
    ]);
  });

  test("a link that is already right is ok; one pointing elsewhere is replaced", () => {
    const actions = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: ["go-modern", "writeup"],
      entries: [
        { name: "go-modern", state: { kind: "symlink", target: `${SOURCE}/go-modern` } },
        { name: "writeup", state: { kind: "symlink", target: "/old/core/skills/writeup" } },
      ],
    });
    expect(actions.map((a) => (a.kind === "link" ? a.plan.state : a.kind))).toEqual([
      "ok",
      "replace",
    ]);
  });

  test("a jig link that is no longer planned is stale and removed", () => {
    const actions = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: ["writeup"],
      entries: [{ name: "retired", state: { kind: "symlink", target: `${SOURCE}/retired` } }],
    });
    expect(actions[1]).toEqual({
      kind: "stale",
      name: "retired",
      path: `${DIR}/retired`,
      target: `${SOURCE}/retired`,
    });
  });

  test("anything not jig's — Claude Code's synced tree and marker, a link elsewhere — is left alone and named", () => {
    const actions = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: [],
      entries: [
        { name: "synced", state: { kind: "dir" } },
        { name: ".bucket-abc", state: { kind: "file" } },
        { name: "elsewhere", state: { kind: "symlink", target: "/somewhere/else" } },
      ],
    });
    expect(actions.map((a) => a.kind)).toEqual(["foreign", "foreign", "foreign"]);
    expect(actions.map((a) => `${a.name}: ${a.kind === "foreign" ? a.what : ""}`)).toEqual([
      ".bucket-abc: a regular file",
      "elsewhere: a symlink → /somewhere/else",
      "synced: a directory",
    ]);
  });

  test("a stale link is one INTO the source directory, not merely one jig would not make: the prefix is the whole test", () => {
    const actions = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: [],
      entries: [
        { name: "a", state: { kind: "symlink", target: `${SOURCE}-other/a` } },
        { name: "b", state: { kind: "symlink", target: `${SOURCE}/README.md` } },
      ],
    });
    expect(actions.map((a) => `${a.name}:${a.kind}`)).toEqual(["b:stale", "a:foreign"]);
  });

  test("a planned entry blocked by a real directory or a file is backed up, never deleted", () => {
    const actions = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: ["mine", "note"],
      entries: [
        { name: "mine", state: { kind: "dir" } },
        { name: "note", state: { kind: "file" } },
      ],
    });
    expect(actions.map((a) => (a.kind === "link" ? a.plan.state : a.kind))).toEqual([
      "backup-then-create",
      "backup-then-create",
    ]);
  });
});

describe("describePathState", () => {
  test("names each state in the dry-run's words", () => {
    expect(describePathState({ kind: "missing" })).toBe("missing");
    expect(describePathState({ kind: "file" })).toBe("a regular file");
    expect(describePathState({ kind: "dir" })).toBe("a directory");
    expect(describePathState({ kind: "symlink", target: "/x" })).toBe("a symlink → /x");
  });
});
