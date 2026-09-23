import { describe, expect, test } from "bun:test";
import {
  describePathState,
  describeStaleReason,
  reconcileManagedDir,
} from "../../../src/domain/claude/managed-dir";

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
      reason: "unplanned",
    });
  });

  test("a link under a former source tree is stale only when the caller names that tree", () => {
    const entries = [
      { name: "old", state: { kind: "symlink" as const, target: "/old/core/skills/old" } },
    ];
    const narrow = reconcileManagedDir({ dir: DIR, sourceDir: SOURCE, planned: [], entries });
    expect(narrow.map((a) => a.kind)).toEqual(["foreign"]);

    const widened = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: [],
      formerSourceDirs: ["/old/core", "/old/packs"],
      entries,
    });
    expect(widened[0]).toEqual({
      kind: "stale",
      name: "old",
      path: `${DIR}/old`,
      target: "/old/core/skills/old",
      reason: "former-tree",
    });
  });

  test("a dangling link is stale only when the caller followed it and said so", () => {
    const target = "/gone/skills/x";
    const unprobed = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: [],
      entries: [{ name: "x", state: { kind: "symlink", target } }],
    });
    expect(unprobed.map((a) => a.kind)).toEqual(["foreign"]);

    const probed = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: [],
      entries: [
        { name: "x", state: { kind: "symlink", target }, dangling: true },
        { name: "y", state: { kind: "symlink", target: "/elsewhere/y" }, dangling: false },
      ],
    });
    expect(probed.map((a) => `${a.name}:${a.kind}`)).toEqual(["x:stale", "y:foreign"]);
    expect(probed[0]).toMatchObject({ reason: "dangling" });
  });

  test("targetOf points a planned link somewhere under the source other than <sourceDir>/<name>", () => {
    const actions = reconcileManagedDir({
      dir: DIR,
      sourceDir: SOURCE,
      planned: ["grilling"],
      targetOf: (name) => `${SOURCE}/${name}/codex`,
      entries: [
        { name: "grilling", state: { kind: "symlink", target: `${SOURCE}/grilling/codex` } },
      ],
    });
    expect(actions).toEqual([
      {
        kind: "link",
        name: "grilling",
        plan: { path: `${DIR}/grilling`, target: `${SOURCE}/grilling/codex`, state: "ok" },
      },
    ]);
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

describe("describeStaleReason", () => {
  test("names each reason in the dry-run's words", () => {
    expect(describeStaleReason("unplanned")).toBe("stale jig link");
    expect(describeStaleReason("former-tree")).toBe("link into the retired tree");
    expect(describeStaleReason("dangling")).toBe("dangling link");
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
