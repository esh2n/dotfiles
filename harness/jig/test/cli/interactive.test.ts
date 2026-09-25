import { describe, expect, test } from "bun:test";
import type { BoxCliContext } from "../../src/cli/box";
import {
  HARNESSES,
  type InteractiveDeps,
  type Prompter,
  interactive,
} from "../../src/cli/interactive";
import { fakeBoxPorts, listing } from "../app/box/fake-ports";

const CONTEXT: BoxCliContext = {
  cwd: "/Users/x/dotfiles",
  postureKits: { guarded: "/repo/postures/guarded", connected: "/repo/postures/connected" },
  dryRun: false,
  noAttach: true,
};

interface Script {
  /** Answers, consumed in order; `undefined` means "cancelled". */
  readonly answers: readonly (number | undefined)[];
  readonly confirm?: boolean;
  readonly installed?: readonly string[];
}

function deps(script: Script, box = fakeBoxPorts()) {
  const titles: string[] = [];
  const shown: string[][] = [];
  const spawned: { command: string; args: readonly string[] }[] = [];
  let asked = 0;

  const prompt: Prompter = {
    async select(title, options) {
      titles.push(title);
      shown.push([...options]);
      return script.answers[asked++];
    },
    async confirm() {
      return script.confirm ?? false;
    },
  };

  const all: InteractiveDeps = {
    prompt,
    which: async (command) =>
      (script.installed ?? ["claude", "codex", "pi", "omp"]).includes(command),
    spawn: async (command, args) => {
      spawned.push({ command, args });
      return 0;
    },
    box: box.ports,
    context: CONTEXT,
  };

  return { deps: all, titles, shown, spawned, box };
}

describe("interactive", () => {
  test("first question is the harness, marking the ones not on PATH", async () => {
    const harness = deps({ answers: [undefined], installed: ["claude"] });
    await interactive(harness.deps);

    expect(harness.titles[0]).toBe("harness");
    expect(harness.shown[0]).toEqual([
      "Claude Code",
      "Codex (not installed)",
      "pi (not installed)",
      "omp (not installed)",
      "DSH (not installed)",
    ]);
  });

  test("every harness the entry point offers is one of the five", () => {
    expect(HARNESSES.map((h) => h.id)).toEqual(["claude", "codex", "pi", "omp", "dsh"]);
  });

  test("an empty answer cancels without running anything", async () => {
    const harness = deps({ answers: [undefined] });
    const result = await interactive(harness.deps);

    expect(result).toEqual({ stdout: "", code: 0 });
    expect(harness.spawned).toEqual([]);
    expect(harness.box.calls).toEqual([]);
  });

  test("host + new session spawns the harness in the working directory", async () => {
    const harness = deps({ answers: [0, 0, 0] });
    await interactive(harness.deps);

    expect(harness.spawned).toEqual([{ command: "claude", args: [] }]);
  });

  test("host + continue uses each harness's own resume argument", async () => {
    const claude = deps({ answers: [0, 0, 1] });
    await interactive(claude.deps);
    expect(claude.spawned[0]).toEqual({ command: "claude", args: ["--continue"] });

    const codex = deps({ answers: [1, 0, 1] });
    await interactive(codex.deps);
    expect(codex.spawned[0]).toEqual({ command: "codex", args: ["resume", "--last"] });

    const pi = deps({ answers: [2, 0, 1] });
    await interactive(pi.deps);
    expect(pi.spawned[0]).toEqual({ command: "pi", args: ["--continue"] });
  });

  test("a harness with no known resume flag is not offered one", async () => {
    // dsh is not installed here, so its --help could not be read; rather than
    // guess a flag, the option is left out.
    const harness = deps({ answers: [4, 0, 0] });
    await interactive(harness.deps);

    expect(harness.shown[2]).toEqual(["new session"]);
    expect(harness.spawned[0]).toEqual({ command: "dsh", args: [] });
  });

  test("the box option says which harnesses have no built-in sbx agent", async () => {
    const harness = deps({ answers: [2, undefined] });
    await interactive(harness.deps);

    expect(harness.shown[1]?.[1]).toContain("no built-in sbx agent");
  });

  test("choosing a box for such a harness refuses instead of guessing", async () => {
    const harness = deps({ answers: [3, 1] });
    const result = await interactive(harness.deps);

    expect(result.code).toBe(2);
    expect(result.stdout).toContain("no built-in sbx agent for omp");
    expect(harness.box.calls).toEqual([]);
  });

  test("box + new asks about the token exactly once, and defaults to no", async () => {
    const box = fakeBoxPorts({ sbx: { ls: { stdout: listing([]) } } });
    const harness = deps({ answers: [0, 1, 0], confirm: false }, box);
    await interactive(harness.deps);

    const create = box.calls.find((call) => call[0] === "create") ?? [];
    expect(create).toContain("/repo/postures/guarded");
    expect(create).not.toContain("/repo/postures/connected");
  });

  test("saying yes to the token question picks the connected posture", async () => {
    const box = fakeBoxPorts({ sbx: { ls: { stdout: listing([]) } } });
    const harness = deps({ answers: [0, 1, 0], confirm: true }, box);
    await interactive(harness.deps);

    expect(box.calls.find((call) => call[0] === "create")).toContain("/repo/postures/connected");
  });

  test("box + resume lists this repository's boxes and attaches to the chosen one", async () => {
    const box = fakeBoxPorts({
      sbx: {
        ls: {
          stdout: listing([
            { name: "claude-dotfiles-main", lastUsedAt: "2026-09-22T10:00:00Z" },
            { name: "claude-dotfiles-wip", lastUsedAt: "2026-09-22T12:00:00Z" },
          ]),
        },
      },
    });
    const harness = deps({ answers: [0, 1, 2] }, box);
    await interactive(harness.deps);

    // Newest first, after "new box".
    expect(harness.shown[2]?.[0]).toBe("new box");
    expect(harness.shown[2]?.[1]).toContain("claude-dotfiles-wip");
    expect(box.attached).toEqual([["run", "--name", "claude-dotfiles-main", "--", "--continue"]]);
  });

  test("an sbx that cannot list is a failure, not an empty box list", async () => {
    // Otherwise "new box" is the only option offered and the user creates a
    // duplicate of a box that is sitting right there.
    const box = fakeBoxPorts({ sbx: { ls: { code: 1, stderr: "daemon down" } } });
    const harness = deps({ answers: [0, 1, 0], confirm: false }, box);
    const result = await interactive(harness.deps);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("daemon down");
    expect(box.sbxCall("create")).toBeUndefined();
    // The box menu was never even shown: harness, then where, and that is all.
    expect(harness.shown).toHaveLength(2);
  });

  test("a box outside a repository is refused before sbx is touched", async () => {
    const box = fakeBoxPorts({ toplevel: undefined });
    const harness = deps({ answers: [0, 1] }, box);
    const result = await interactive(harness.deps);

    expect(result.code).toBe(2);
    expect(result.stdout).toContain("not inside a git repository");
    expect(box.calls).toEqual([]);
  });
});
