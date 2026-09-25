import { describe, expect, test } from "bun:test";
import { type BoxCliContext, boxCli } from "../../src/cli/box";
import { fakeBoxPorts, listing } from "../app/box/fake-ports";

const CONTEXT: BoxCliContext = {
  cwd: "/Users/x/dotfiles/domains/dev",
  postureKits: { guarded: "/repo/postures/guarded", connected: "/repo/postures/connected" },
  dryRun: false,
  noAttach: true,
};

describe("boxCli new", () => {
  test("defaults to claude and the guarded posture", async () => {
    const fake = fakeBoxPorts();
    const result = await boxCli(["new"], fake.ports, CONTEXT);

    expect(result.code).toBe(0);
    expect(fake.sbxCall("create")).toContain("/repo/postures/guarded");
    // The fork kit stands in for the agent name — that is what replaces the
    // built-in --dangerously-skip-permissions entrypoint.
    expect(fake.sbxCall("create")).toContain("/tmp/jig-box/claude-dotfiles-main");
    expect(fake.sbxCall("create")).not.toContain("claude");
  });

  test("--pr swaps in the connected posture, and nothing else does", async () => {
    const withPr = fakeBoxPorts();
    await boxCli(["new", "--pr"], withPr.ports, CONTEXT);
    expect(withPr.sbxCall("create")).toContain("/repo/postures/connected");

    const without = fakeBoxPorts();
    await boxCli(["new", "--agent", "codex"], without.ports, CONTEXT);
    expect(without.sbxCall("create")).toContain("/repo/postures/guarded");
    expect(without.sbxCall("create")).not.toContain("/repo/postures/connected");
  });

  test("--agent codex is accepted", async () => {
    const fake = fakeBoxPorts();
    const result = await boxCli(["new", "--agent=codex"], fake.ports, CONTEXT);

    expect(result.code).toBe(0);
    expect(fake.sbxCall("create")).toContain("/tmp/jig-box/codex-dotfiles-main");
    expect(fake.kit.files?.["spec.yaml"]).toContain("extends: codex");
    expect(fake.kit.files?.["files/home/.codex/AGENTS.md"]).toBe("# box");
  });

  test("a harness with no built-in sbx agent is a typed refusal, not a guess", async () => {
    for (const agent of ["pi", "dsh", "omp"]) {
      const fake = fakeBoxPorts();
      const result = await boxCli(["new", "--agent", agent], fake.ports, CONTEXT);

      expect(result.code).toBe(2);
      expect(result.stdout).toContain("no built-in sbx agent");
      expect(result.stdout).toContain("claude, codex");
      expect(fake.calls).toEqual([]);
    }
  });

  test("--dry-run prints the command and creates nothing", async () => {
    const fake = fakeBoxPorts();
    const result = await boxCli(["new", "--dry-run"], fake.ports, CONTEXT);

    expect(fake.sbxCall("create")).toBeUndefined();
    expect(result.stdout).toContain("sbx create --clone --skills=off --name claude-dotfiles-main");
  });

  test("JIG_BOX_DRY_RUN has the same effect as the flag", async () => {
    const fake = fakeBoxPorts();
    const result = await boxCli(["new"], fake.ports, { ...CONTEXT, dryRun: true });

    expect(fake.sbxCall("create")).toBeUndefined();
    expect(result.stdout).toContain("sbx create");
  });

  test("--path picks a different repository", async () => {
    const fake = fakeBoxPorts();
    await boxCli(["new", "--path", "/somewhere/else"], fake.ports, CONTEXT);
    // The fake resolves every path to the same root; what matters is that the
    // flag parsed rather than being rejected as unknown.
    expect(fake.sbxCall("create")).toBeDefined();
  });

  test("an unknown flag is refused", async () => {
    const fake = fakeBoxPorts();
    const result = await boxCli(["new", "--yolo"], fake.ports, CONTEXT);

    expect(result.code).toBe(2);
    expect(result.stdout).toContain("unknown argument");
  });
});

describe("boxCli list", () => {
  test("shows this repository's boxes, newest first", async () => {
    const fake = fakeBoxPorts({
      sbx: {
        ls: {
          stdout: listing([
            { name: "claude-dotfiles-main", lastUsedAt: "2026-09-22T10:00:00Z" },
            {
              name: "claude-elsewhere-main",
              lastUsedAt: "2026-09-22T11:00:00Z",
              workspace: "/Users/x/elsewhere",
            },
          ]),
        },
      },
    });
    const result = await boxCli(["list"], fake.ports, CONTEXT);

    expect(result.stdout).toContain("claude-dotfiles-main");
    expect(result.stdout).not.toContain("claude-elsewhere-main");
  });

  test("--all drops the repository filter", async () => {
    const fake = fakeBoxPorts({
      sbx: {
        ls: {
          stdout: listing([{ name: "claude-elsewhere-main", workspace: "/Users/x/elsewhere" }]),
        },
      },
    });
    const result = await boxCli(["list", "--all"], fake.ports, CONTEXT);
    expect(result.stdout).toContain("claude-elsewhere-main");
  });

  test("an empty list says so", async () => {
    const fake = fakeBoxPorts({ sbx: { ls: { stdout: listing([]) } } });
    expect((await boxCli(["list"], fake.ports, CONTEXT)).stdout).toBe("no boxes\n");
  });
});

describe("boxCli resume / fetch / rm", () => {
  test("resume attaches with the agent's own continue argument", async () => {
    const fake = fakeBoxPorts({ sbx: { ls: { stdout: listing([{ name: "b" }]) } } });
    await boxCli(["resume", "b"], fake.ports, CONTEXT);
    expect(fake.attached).toEqual([["run", "--name", "b", "--", "--continue"]]);
  });

  test("fetch pulls into the box's own remote namespace", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", gitPort: 7000 }]) } },
    });
    const result = await boxCli(["fetch", "b"], fake.ports, CONTEXT);

    expect(fake.gitCalls[0]).toEqual([
      "fetch",
      "--prune",
      "git://127.0.0.1:7000/dotfiles",
      "+refs/heads/*:refs/remotes/sandbox-b/*",
    ]);
    expect(result.code).toBe(0);
  });

  test("rm forces", async () => {
    const fake = fakeBoxPorts({ sbx: { ls: { stdout: listing([{ name: "b" }]) } } });
    await boxCli(["rm", "b"], fake.ports, CONTEXT);
    expect(fake.sbxCall("rm")).toEqual(["rm", "--force", "b"]);
  });

  test("resume and rm refuse a box from a different checkout", async () => {
    for (const subcommand of ["resume", "rm"]) {
      const fake = fakeBoxPorts({
        sbx: { ls: { stdout: listing([{ name: "b", workspace: "/Users/x/elsewhere" }]) } },
      });
      const result = await boxCli([subcommand, "b"], fake.ports, CONTEXT);

      expect(result.code).toBe(2);
      expect(result.stdout).toContain("belongs to /Users/x/elsewhere");
      expect(fake.sbxCall("rm")).toBeUndefined();
      expect(fake.attached).toEqual([]);
    }
  });

  test("each of them needs a name", async () => {
    for (const subcommand of ["resume", "fetch", "rm"]) {
      const fake = fakeBoxPorts();
      const result = await boxCli([subcommand], fake.ports, CONTEXT);
      expect(result.code).toBe(2);
      expect(result.stdout).toContain("need a name");
    }
  });
});

describe("boxCli usage", () => {
  test("no subcommand prints usage and exits 0", async () => {
    const result = await boxCli([], fakeBoxPorts().ports, CONTEXT);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("usage: jig box");
  });

  test("an unknown subcommand exits 2", async () => {
    const result = await boxCli(["frobnicate"], fakeBoxPorts().ports, CONTEXT);
    expect(result.code).toBe(2);
  });
});
