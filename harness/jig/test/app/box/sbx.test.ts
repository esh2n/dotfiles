import { describe, expect, test } from "bun:test";
import {
  type Box,
  belongsTo,
  byNewest,
  createArgs,
  fetchArgs,
  formatSbxCommand,
  gitDaemonPort,
  parseSandboxList,
  removeArgs,
  runArgs,
  wakeArgs,
} from "../../../src/app/box/sbx";

/** The shape `sbx ls --json` returns on v0.43.0 (ports only while running). */
const LISTING = JSON.stringify({
  sandboxes: [
    {
      name: "claude-dotfiles-main",
      id: "d1de0efd",
      agent: "claude",
      status: "running",
      last_used_at: "2026-09-22T10:00:00Z",
      workspaces: ["/Users/x/dotfiles"],
      ports: [{ sandbox_port: 9418, host_port: 53124, protocol: "tcp" }],
    },
    {
      name: "codex-dotfiles-wip",
      id: "8dbb9ded",
      agent: "codex",
      status: "stopped",
      last_used_at: "2026-09-21T05:44:20Z",
      workspaces: ["/Users/x/dotfiles"],
    },
  ],
});

describe("createArgs", () => {
  test("the fork kit takes the agent's place; only mixins go behind --kit", () => {
    expect(
      createArgs({
        name: "claude-dotfiles-main",
        kitDir: "/tmp/jig-box/claude-dotfiles-main",
        mixinDirs: ["/repo/kits/postures/guarded"],
        repoPath: "/Users/x/dotfiles",
      }),
    ).toEqual([
      "create",
      "--clone",
      "--skills=off",
      "--name",
      "claude-dotfiles-main",
      "--kit",
      "/repo/kits/postures/guarded",
      "/tmp/jig-box/claude-dotfiles-main",
      "/Users/x/dotfiles",
    ]);
  });

  test("never names a built-in agent — that is what the fork replaces", () => {
    const args = createArgs({ name: "n", kitDir: "/tmp/kit", mixinDirs: [], repoPath: "/repo" });
    expect(args).not.toContain("claude");
    expect(args).not.toContain("codex");
  });

  test("never adds a second workspace — sub-mounts over a clone hang create", () => {
    const args = createArgs({ name: "n", kitDir: "/tmp/kit", mixinDirs: [], repoPath: "/repo" });
    expect(args.filter((arg) => arg === "/repo")).toHaveLength(1);
    expect(args.some((arg) => arg.endsWith(":ro"))).toBe(false);
  });
});

describe("belongsTo", () => {
  const box = (workspaces: string[]): Box => ({
    name: "b",
    id: "",
    agent: "jig-claude",
    status: "running",
    lastUsedAt: "",
    workspaces,
    ports: [],
  });

  test("matches the workspace the box was cloned from", () => {
    expect(belongsTo(box(["/Users/x/dotfiles"]), "/Users/x/dotfiles")).toBe(true);
  });

  test("does not match a different checkout with the same basename", () => {
    expect(belongsTo(box(["/Users/x/a/app"]), "/Users/x/b/app")).toBe(false);
  });

  test("ignores a read-only suffix on an extra mount", () => {
    expect(belongsTo(box(["/tmp/w", "/Users/x/dotfiles:ro"]), "/Users/x/dotfiles")).toBe(true);
  });

  test("a box with no workspaces belongs to nothing", () => {
    expect(belongsTo(box([]), "/Users/x/dotfiles")).toBe(false);
  });
});

describe("runArgs", () => {
  test("re-attaches by name without naming the agent again", () => {
    expect(runArgs({ name: "b", agentArgs: [] })).toEqual(["run", "--name", "b"]);
  });

  test("agent arguments go after the separator", () => {
    expect(runArgs({ name: "b", agentArgs: ["--continue"] })).toEqual([
      "run",
      "--name",
      "b",
      "--",
      "--continue",
    ]);
  });
});

describe("parseSandboxList", () => {
  test("reads names, agents, status and published ports", () => {
    const boxes = parseSandboxList(LISTING);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.name).toBe("claude-dotfiles-main");
    expect(boxes[0]?.ports).toEqual([{ sandboxPort: 9418, hostPort: 53124 }]);
    expect(boxes[1]?.status).toBe("stopped");
    expect(boxes[1]?.ports).toEqual([]);
  });

  test("garbage in gives an empty list, not a throw", () => {
    expect(parseSandboxList("not json")).toEqual([]);
    expect(parseSandboxList("{}")).toEqual([]);
    expect(parseSandboxList('{"sandboxes":[{"no":"name"}]}')).toEqual([]);
  });
});

describe("byNewest", () => {
  test("orders by last use, newest first", () => {
    expect(byNewest(parseSandboxList(LISTING)).map((box) => box.name)).toEqual([
      "claude-dotfiles-main",
      "codex-dotfiles-wip",
    ]);
  });
});

describe("gitDaemonPort", () => {
  test("finds the host port 9418 is published on", () => {
    expect(gitDaemonPort(parseSandboxList(LISTING), "claude-dotfiles-main")).toBe(53124);
  });

  test("a stopped box publishes nothing", () => {
    expect(gitDaemonPort(parseSandboxList(LISTING), "codex-dotfiles-wip")).toBeUndefined();
  });

  test("an unknown name is undefined, not a throw", () => {
    expect(gitDaemonPort(parseSandboxList(LISTING), "nope")).toBeUndefined();
  });

  test("a box publishing only other ports is undefined", () => {
    const boxes: Box[] = [
      {
        name: "b",
        id: "",
        agent: "claude",
        status: "running",
        lastUsedAt: "",
        workspaces: [],
        ports: [{ sandboxPort: 3000, hostPort: 3000 }],
      },
    ];
    expect(gitDaemonPort(boxes, "b")).toBeUndefined();
  });
});

describe("fetchArgs", () => {
  test("fetches the clone's branches into a per-box remote namespace", () => {
    expect(
      fetchArgs({ repoRoot: "/Users/x/dotfiles", name: "claude-dotfiles-main", port: 53124 }),
    ).toEqual([
      "fetch",
      "--prune",
      "git://127.0.0.1:53124/dotfiles",
      "+refs/heads/*:refs/remotes/sandbox-claude-dotfiles-main/*",
    ]);
  });
});

describe("wakeArgs / removeArgs", () => {
  test("waking is a no-op exec; removal is forced so nothing prompts", () => {
    expect(wakeArgs("b")).toEqual(["exec", "b", "--", "true"]);
    expect(removeArgs("b")).toEqual(["rm", "--force", "b"]);
  });
});

describe("formatSbxCommand", () => {
  test("renders a pasteable command line and quotes what needs it", () => {
    expect(formatSbxCommand(["create", "--name", "a b"])).toBe("sbx create --name 'a b'");
    expect(formatSbxCommand(["run", "--name", "claude-dotfiles-main"])).toBe(
      "sbx run --name claude-dotfiles-main",
    );
  });
});
