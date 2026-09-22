import { describe, expect, test } from "bun:test";
import { createBox } from "../../../src/app/box/create";
import { fetchBox } from "../../../src/app/box/fetch";
import { forRepo, listBoxes } from "../../../src/app/box/list";
import { removeBox } from "../../../src/app/box/remove";
import { resumeBox } from "../../../src/app/box/resume";
import { parseSandboxList } from "../../../src/app/box/sbx";
import { fakeBoxPorts, listing } from "./fake-ports";

const NEW = {
  agent: "claude" as const,
  path: "/Users/x/dotfiles/domains",
  postureKitDir: "/repo/kits/postures/guarded",
  dryRun: false,
  attach: false,
};

describe("createBox", () => {
  test("clones the repository root, not the directory the caller was in", async () => {
    const fake = fakeBoxPorts();
    const result = await createBox(NEW, fake.ports);

    expect(result.code).toBe(0);
    expect(fake.sbxCall("create")).toEqual([
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

  test("the kit it writes carries jig's source, the policy and the instructions", async () => {
    const fake = fakeBoxPorts();
    await createBox(NEW, fake.ports);

    expect(fake.kit.files?.["spec.yaml"]).toContain("extends: claude");
    expect(fake.kit.files?.["files/home/.local/share/jig/src/cli/jig.ts"]).toBe("// entry");
    expect(fake.kit.files?.["files/home/.config/jig/policy/guard-rules.json"]).toBe(
      '{"version":3,"rules":[]}',
    );
    expect(fake.kit.files?.["files/home/.claude/CLAUDE.md"]).toBe("# box");
  });

  test("--pr is the only way the connected posture is reached", async () => {
    const fake = fakeBoxPorts();
    await createBox({ ...NEW, postureKitDir: "/repo/kits/postures/connected" }, fake.ports);
    expect(fake.sbxCall("create")).toContain("/repo/kits/postures/connected");
  });

  test("a dry run writes the kit but creates nothing", async () => {
    const fake = fakeBoxPorts();
    const result = await createBox({ ...NEW, dryRun: true, attach: true }, fake.ports);

    expect(fake.sbxCall("create")).toBeUndefined();
    expect(fake.attached).toEqual([]);
    expect(result.lines.join("\n")).toContain("sbx create --clone --skills=off --name");
    expect(result.lines.join("\n")).toContain("sbx run --name claude-dotfiles-main");
    expect(result.code).toBe(0);
  });

  test("attaching happens only after create succeeds", async () => {
    const fake = fakeBoxPorts({ sbx: { create: { code: 1, stderr: "boom" } } });
    const result = await createBox({ ...NEW, attach: true }, fake.ports);

    expect(fake.attached).toEqual([]);
    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("boom");
  });

  test("with attach, the terminal is handed over by name", async () => {
    const fake = fakeBoxPorts({ attachCode: 3 });
    const result = await createBox({ ...NEW, attach: true }, fake.ports);

    expect(fake.attached).toEqual([["run", "--name", "claude-dotfiles-main"]]);
    expect(result.code).toBe(3);
  });

  test("refuses while sbx would forward the host SSH agent into the box", async () => {
    // Measured on sbx v0.43.0: dropping SSH_AUTH_SOCK from the sbx process
    // does not stop the forwarding, so this global setting is the only gate.
    const fake = fakeBoxPorts({ sbx: { settings: { stdout: "true\n" } } });
    const result = await createBox(NEW, fake.ports);

    expect(result.code).toBe(2);
    expect(fake.sbxCall("create")).toBeUndefined();
    expect(result.lines.join("\n")).toContain("sbx settings set ssh.agentForwardingEnabled false");
  });

  test("never flips that setting itself", async () => {
    const fake = fakeBoxPorts({ sbx: { settings: { stdout: "true\n" } } });
    await createBox(NEW, fake.ports);

    expect(fake.calls.filter((call) => call[0] === "settings")).toEqual([
      ["settings", "get", "ssh.agentForwardingEnabled"],
    ]);
  });

  test("an unreadable setting reads as on, not as off", async () => {
    const fake = fakeBoxPorts({ sbx: { settings: { code: 1, stderr: "no such key" } } });
    const result = await createBox(NEW, fake.ports);

    expect(result.code).toBe(2);
    expect(fake.sbxCall("create")).toBeUndefined();
  });

  test("a dry run says the refusal would happen rather than hiding it", async () => {
    const fake = fakeBoxPorts({ sbx: { settings: { stdout: "true\n" } } });
    const result = await createBox({ ...NEW, dryRun: true }, fake.ports);

    expect(result.lines.join("\n")).toContain("sbx settings set ssh.agentForwardingEnabled false");
  });

  test("a path outside a repository is refused before anything is created", async () => {
    const fake = fakeBoxPorts({ toplevel: undefined });
    const result = await createBox(NEW, fake.ports);

    expect(result.code).toBe(2);
    expect(fake.calls).toEqual([]);
    expect(result.lines.join("\n")).toContain("not inside a git repository");
  });

  test("a source it cannot read is a message, not a stack trace", async () => {
    const fake = fakeBoxPorts({ sourceError: "no guard policy found at /a or /b" });
    const result = await createBox(NEW, fake.ports);

    expect(result.code).toBe(2);
    expect(result.lines).toEqual(["jig box new: no guard policy found at /a or /b"]);
    expect(fake.sbxCall("create")).toBeUndefined();
  });

  test("refuses when the derived name is another checkout's box", async () => {
    // Two repositories both called `dotfiles`, same agent, same branch.
    const fake = fakeBoxPorts({
      sbx: {
        ls: {
          stdout: listing([{ name: "claude-dotfiles-main", workspace: "/Users/x/other/dotfiles" }]),
        },
      },
    });
    const result = await createBox(NEW, fake.ports);

    expect(result.code).toBe(2);
    expect(fake.sbxCall("create")).toBeUndefined();
    expect(result.lines.join("\n")).toContain("/Users/x/other/dotfiles");
    expect(result.lines.join("\n")).toContain("jig box rm claude-dotfiles-main");
  });

  test("a box of the same name from this very repository is sbx's business, not a refusal", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "claude-dotfiles-main" }]) } },
    });
    await createBox(NEW, fake.ports);

    expect(fake.sbxCall("create")).toBeDefined();
  });
});

describe("listBoxes", () => {
  test("narrows to the boxes cloned from this repository", async () => {
    const fake = fakeBoxPorts({
      sbx: {
        ls: {
          stdout: listing([
            { name: "claude-dotfiles-main", lastUsedAt: "2026-09-22T10:00:00Z" },
            { name: "codex-dotfiles-wip", lastUsedAt: "2026-09-22T12:00:00Z" },
            {
              name: "claude-other-main",
              lastUsedAt: "2026-09-22T13:00:00Z",
              workspace: "/Users/x/other",
            },
          ]),
        },
      },
    });
    const result = await listBoxes({ repoPath: "/Users/x/dotfiles" }, fake.ports);

    // Newest first, and the unrelated repository's box is not in it.
    expect(result.boxes.map((box) => box.name)).toEqual([
      "codex-dotfiles-wip",
      "claude-dotfiles-main",
    ]);
  });

  test("a box named for this repo but cloned from another is not this repo's", async () => {
    // The whole point of matching on workspace: the name says `dotfiles`.
    const fake = fakeBoxPorts({
      sbx: {
        ls: {
          stdout: listing([
            { name: "claude-dotfiles-main", workspace: "/Users/x/elsewhere/dotfiles" },
          ]),
        },
      },
    });
    const result = await listBoxes({ repoPath: "/Users/x/dotfiles" }, fake.ports);
    expect(result.boxes).toEqual([]);
  });

  test("an sbx failure is reported rather than read as an empty list", async () => {
    const fake = fakeBoxPorts({ sbx: { ls: { code: 1, stderr: "daemon down" } } });
    const result = await listBoxes({}, fake.ports);

    expect(result.code).toBe(1);
    expect(result.error).toBe("daemon down");
    expect(result.boxes).toEqual([]);
  });
});

describe("forRepo", () => {
  test("matches on the workspace, not on the name", () => {
    const boxes = parseSandboxList(
      listing([
        { name: "claude-dotfiles-main" },
        { name: "claude-dotfiles-main-2", workspace: "/Users/x/notes" },
      ]),
    );
    expect(forRepo(boxes, "/Users/x/dotfiles").map((box) => box.name)).toEqual([
      "claude-dotfiles-main",
    ]);
  });
});

describe("resumeBox", () => {
  test("maps the fork kit's name back to the agent it resumes", async () => {
    // `sbx ls --json` reports jig-claude / jig-codex, not claude / codex.
    const claude = fakeBoxPorts({ sbx: { ls: { stdout: listing([{ name: "b" }]) } } });
    await resumeBox({ name: "b", dryRun: false }, claude.ports);
    expect(claude.attached).toEqual([["run", "--name", "b", "--", "--continue"]]);

    const codex = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", agent: "jig-codex" }]) } },
    });
    await resumeBox({ name: "b", dryRun: false }, codex.ports);
    expect(codex.attached).toEqual([["run", "--name", "b", "--", "resume", "--last"]]);
  });

  test("a box created from a plain built-in agent still resumes", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", agent: "codex" }]) } },
    });
    await resumeBox({ name: "b", dryRun: false }, fake.ports);
    expect(fake.attached).toEqual([["run", "--name", "b", "--", "resume", "--last"]]);
  });

  test("an agent jig has no resume argument for is still attached to", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", agent: "gemini" }]) } },
    });
    await resumeBox({ name: "b", dryRun: false }, fake.ports);
    expect(fake.attached).toEqual([["run", "--name", "b"]]);
  });

  test("an unknown box is an error, not an attach", async () => {
    const fake = fakeBoxPorts({ sbx: { ls: { stdout: listing([]) } } });
    const result = await resumeBox({ name: "b", dryRun: false }, fake.ports);

    expect(result.code).toBe(2);
    expect(fake.attached).toEqual([]);
  });

  test("refuses a box that belongs to another checkout", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", workspace: "/Users/x/other" }]) } },
    });
    const result = await resumeBox(
      { name: "b", repoRoot: "/Users/x/dotfiles", dryRun: false },
      fake.ports,
    );

    expect(result.code).toBe(2);
    expect(result.lines.join("\n")).toContain("belongs to /Users/x/other");
    expect(fake.attached).toEqual([]);
  });

  test("outside a repository there is nothing to check against, so the name stands", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", workspace: "/Users/x/other" }]) } },
    });
    await resumeBox({ name: "b", dryRun: false }, fake.ports);
    expect(fake.attached).toHaveLength(1);
  });

  test("an sbx failure is reported rather than read as 'no such box'", async () => {
    const fake = fakeBoxPorts({ sbx: { ls: { code: 1, stderr: "daemon down" } } });
    const result = await resumeBox({ name: "b", dryRun: false }, fake.ports);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("daemon down");
    expect(fake.attached).toEqual([]);
  });
});

describe("fetchBox", () => {
  test("fetches from the port the box publishes right now", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", gitPort: 53124 }]) } },
    });
    const result = await fetchBox({ name: "b", path: "/Users/x/dotfiles" }, fake.ports);

    expect(result.code).toBe(0);
    expect(fake.gitCalls).toEqual([
      [
        "fetch",
        "--prune",
        "git://127.0.0.1:53124/dotfiles",
        "+refs/heads/*:refs/remotes/sandbox-b/*",
      ],
    ]);
  });

  test("a stopped box is woken first, then re-read for its new port", async () => {
    let listed = 0;
    const fake = fakeBoxPorts();
    // Two different listings: no ports while stopped, a port once woken.
    fake.ports.sbx.run = async (args) => {
      fake.calls.push([...args]);
      if (args[0] === "ls") {
        listed += 1;
        return {
          code: 0,
          stdout: listing([
            listed === 1 ? { name: "b", status: "stopped" } : { name: "b", gitPort: 61000 },
          ]),
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const result = await fetchBox({ name: "b", path: "/Users/x/dotfiles" }, fake.ports);

    expect(fake.calls.some((call) => call[0] === "exec")).toBe(true);
    expect(fake.gitCalls[0]?.[2]).toBe("git://127.0.0.1:61000/dotfiles");
    expect(result.code).toBe(0);
  });

  test("a git failure surfaces as a nonzero exit", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", gitPort: 1 }]) } },
      git: { fetch: { code: 128, stderr: "connection refused" } },
    });
    const result = await fetchBox({ name: "b", path: "/Users/x/dotfiles" }, fake.ports);

    expect(result.code).toBe(128);
    expect(result.lines.join("\n")).toContain("connection refused");
  });

  test("never pushes", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", gitPort: 53124 }]) } },
    });
    await fetchBox({ name: "b", path: "/Users/x/dotfiles" }, fake.ports);
    expect(fake.gitCalls.some((call) => call.includes("push"))).toBe(false);
  });

  test("a box with no git daemon even after waking is an error, not a silent no-op", async () => {
    // A box created without --clone runs no git daemon; the listing never
    // grows a port however many times it is woken.
    const fake = fakeBoxPorts({ sbx: { ls: { stdout: listing([{ name: "b" }]) } } });
    const result = await fetchBox({ name: "b", path: "/Users/x/dotfiles" }, fake.ports);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("publishes no git daemon port");
    expect(fake.gitCalls).toEqual([]);
  });

  test("refuses a box that belongs to another checkout", async () => {
    const fake = fakeBoxPorts({
      sbx: {
        ls: { stdout: listing([{ name: "b", gitPort: 53124, workspace: "/Users/x/other" }]) },
      },
    });
    const result = await fetchBox({ name: "b", path: "/Users/x/dotfiles" }, fake.ports);

    expect(result.code).toBe(2);
    expect(result.lines.join("\n")).toContain("belongs to /Users/x/other");
    expect(fake.gitCalls).toEqual([]);
  });
});

describe("removeBox", () => {
  const listed = { sbx: { ls: { stdout: listing([{ name: "b" }]) } } };

  test("forces, so nothing waits on a prompt jig cannot answer", async () => {
    const fake = fakeBoxPorts(listed);
    const result = await removeBox({ name: "b", dryRun: false }, fake.ports);

    expect(fake.sbxCall("rm")).toEqual(["rm", "--force", "b"]);
    expect(result.code).toBe(0);
  });

  test("a dry run only prints", async () => {
    const fake = fakeBoxPorts(listed);
    const result = await removeBox({ name: "b", dryRun: true }, fake.ports);

    expect(fake.sbxCall("rm")).toBeUndefined();
    expect(result.lines).toEqual(["sbx rm --force b"]);
  });

  test("a failing sbx rm surfaces as a nonzero exit, not a false 'removed'", async () => {
    const fake = fakeBoxPorts({
      sbx: { ...listed.sbx, rm: { code: 1, stderr: "sandbox is in use" } },
    });
    const result = await removeBox({ name: "b", dryRun: false }, fake.ports);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("sandbox is in use");
    expect(result.lines.join("\n")).not.toContain("removed b");
  });

  test("refuses a box that belongs to another checkout — deletion is irreversible", async () => {
    const fake = fakeBoxPorts({
      sbx: { ls: { stdout: listing([{ name: "b", workspace: "/Users/x/other" }]) } },
    });
    const result = await removeBox(
      { name: "b", repoRoot: "/Users/x/dotfiles", dryRun: false },
      fake.ports,
    );

    expect(result.code).toBe(2);
    expect(fake.sbxCall("rm")).toBeUndefined();
    expect(result.lines.join("\n")).toContain("belongs to /Users/x/other");
  });

  test("an unknown box is an error, not a silent success", async () => {
    const fake = fakeBoxPorts({ sbx: { ls: { stdout: listing([]) } } });
    const result = await removeBox({ name: "b", dryRun: false }, fake.ports);

    expect(result.code).toBe(2);
    expect(fake.sbxCall("rm")).toBeUndefined();
  });
});
