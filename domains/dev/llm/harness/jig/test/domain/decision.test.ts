import { describe, expect, test } from "bun:test";
import { type ToolCall, decide } from "../../src/domain/hooks/decision";

const bash = (command: string): ToolCall => ({ tool: "Bash", input: { command } });

describe("decide", () => {
  test("allows a plain command", () => {
    expect(decide(bash("ls -la"), "standard")).toEqual({ kind: "allow" });
  });

  test("denies git force push on every profile", () => {
    for (const profile of ["minimal", "standard", "strict"] as const) {
      expect(decide(bash("git push --force origin main"), profile).kind).toBe("deny");
      expect(decide(bash("git push -f"), profile).kind).toBe("deny");
    }
  });

  test("asks before rm -rf on standard and above, allows on minimal", () => {
    expect(decide(bash("rm -rf build"), "minimal").kind).toBe("allow");
    expect(decide(bash("rm -rf build"), "standard").kind).toBe("ask");
    expect(decide(bash("rm -rf build"), "strict").kind).toBe("ask");
  });

  test("asks before sudo only under strict", () => {
    expect(decide(bash("sudo xcodebuild -license accept"), "standard").kind).toBe("allow");
    expect(decide(bash("sudo xcodebuild -license accept"), "strict").kind).toBe("ask");
  });

  test("ignores non-Bash tools", () => {
    expect(decide({ tool: "Read", input: { file_path: "/x" } }, "strict")).toEqual({
      kind: "allow",
    });
  });
});
