import { describe, expect, test } from "bun:test";
import { classifyCommands } from "../../../src/domain/claude/commands";

describe("classifyCommands: the retired ~/.claude/commands", () => {
  test("nothing there: absent", () => {
    expect(classifyCommands({ kind: "missing" }, [])).toEqual({ kind: "absent" });
  });

  test("a symlink (today: → .commands-merged) is removed, and the target named", () => {
    const action = classifyCommands(
      { kind: "symlink", target: "/home/u/.claude/.commands-merged" },
      [],
    );
    expect(action.kind).toBe("remove");
    expect(action.kind === "remove" && action.reason).toContain(".commands-merged");
  });

  test("a directory of symlinks only (the staging dir's own shape) is removed", () => {
    const action = classifyCommands({ kind: "dir" }, [
      { name: "plan.md", state: { kind: "symlink", target: "/repo/commands/plan.md" } },
      { name: "prompts", state: { kind: "symlink", target: "/repo/commands/prompts" } },
    ]);
    expect(action).toEqual({
      kind: "remove",
      reason: "a directory of 2 symlinks and nothing else",
    });
  });

  test("a directory holding any regular file is a conflict, and the files are named", () => {
    const action = classifyCommands({ kind: "dir" }, [
      { name: "plan.md", state: { kind: "symlink", target: "/repo/commands/plan.md" } },
      { name: "mine.md", state: { kind: "file" } },
      { name: "sub", state: { kind: "dir" } },
    ]);
    expect(action.kind).toBe("conflict");
    expect(action.kind === "conflict" && action.reason).toContain("mine.md, sub");
  });

  test("a regular file at the path is a conflict too", () => {
    expect(classifyCommands({ kind: "file" }, []).kind).toBe("conflict");
  });
});
