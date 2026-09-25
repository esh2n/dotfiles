import { describe, expect, test } from "bun:test";
import { CLAUDE_HOOK_EVENTS, buildClaudeHooks } from "../../../src/domain/claude/hooks";
import {
  NO_SANDBOX_SOURCE,
  hostSandbox,
  parseSandboxSource,
} from "../../../src/domain/claude/sandbox";

const PATHS = { bun: "/abs/bun", jig: "/abs/jig/src/cli/jig.ts" };

describe("the five hooks", () => {
  test("one event each, and no sixth", () => {
    const hooks = buildClaudeHooks(PATHS);
    expect(Object.keys(hooks).sort()).toEqual([...CLAUDE_HOOK_EVENTS].sort());
    expect(Object.keys(hooks)).toHaveLength(5);
  });

  test("every event holds exactly one group with exactly one command", () => {
    const hooks = buildClaudeHooks(PATHS);
    for (const event of CLAUDE_HOOK_EVENTS) {
      const groups = hooks[event] as unknown[];
      expect(groups).toHaveLength(1);
      const inner = (groups[0] as { hooks: unknown[] }).hooks;
      expect(inner).toHaveLength(1);
      expect(inner[0]).toMatchObject({ type: "command" });
    }
  });

  test("commands are absolute bun + absolute jig, and name the harness", () => {
    const hooks = buildClaudeHooks(PATHS);
    const command = (event: string): string =>
      (hooks[event] as { hooks: { command: string }[] }[])[0]?.hooks[0]?.command ?? "";

    expect(command("PreToolUse")).toBe(
      "/abs/bun /abs/jig/src/cli/jig.ts hooks pre-tool-use --harness claude",
    );
    expect(command("PostToolUse")).toBe(
      "/abs/bun /abs/jig/src/cli/jig.ts hooks post-tool-use-format --harness claude",
    );
    expect(command("Stop")).toBe(
      "/abs/bun /abs/jig/src/cli/jig.ts hooks stop-gate --harness claude",
    );
    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(command(event).startsWith("/abs/bun /abs/jig/")).toBe(true);
    }
  });

  test("the tool events carry a matcher, the turn events do not", () => {
    const hooks = buildClaudeHooks(PATHS);
    const group = (event: string): Record<string, unknown> =>
      (hooks[event] as Record<string, unknown>[])[0] ?? {};

    expect(group("PreToolUse").matcher).toContain("Bash");
    // The formatter never fires on Bash: it formats the file a tool named.
    expect(group("PostToolUse").matcher).toBe("Write|Edit|MultiEdit");
    expect(group("SessionStart")).not.toHaveProperty("matcher");
    expect(group("UserPromptSubmit")).not.toHaveProperty("matcher");
    expect(group("Stop")).not.toHaveProperty("matcher");
  });

  test("every hook has a timeout — none is left to the harness default", () => {
    const hooks = buildClaudeHooks(PATHS);
    for (const event of CLAUDE_HOOK_EVENTS) {
      const hook = (hooks[event] as { hooks: { timeout?: number }[] }[])[0]?.hooks[0];
      expect(typeof hook?.timeout).toBe("number");
    }
  });

  test("the same paths render the same block — no clock, no randomness", () => {
    expect(buildClaudeHooks(PATHS)).toEqual(buildClaudeHooks(PATHS));
  });
});

describe("the host sandbox block", () => {
  test("enabled, fail-closed, no unsandboxed retry; the exclusion list is copied, not decided", () => {
    expect(hostSandbox({ excludedCommands: ["gh", "docker", "open"] })).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: ["gh", "docker", "open"],
    });
  });

  test("the default when policy/sandbox.json is absent is empty — the tightest answer", () => {
    expect(hostSandbox(NO_SANDBOX_SOURCE)).toMatchObject({ excludedCommands: [] });
  });

  test("no network allowlist: that is the box's business, not the host's", () => {
    expect(hostSandbox(NO_SANDBOX_SOURCE)).not.toHaveProperty("network");
  });
});

describe("policy/sandbox.json", () => {
  test("a valid source is taken verbatim", () => {
    expect(parseSandboxSource({ excludedCommands: ["gh"] }, "f")).toEqual({
      excludedCommands: ["gh"],
    });
  });

  test("a malformed list is an error, never silently an empty one", () => {
    expect(() => parseSandboxSource({}, "f")).toThrow('missing "excludedCommands"');
    expect(() => parseSandboxSource({ excludedCommands: "gh" }, "f")).toThrow("array");
    expect(() => parseSandboxSource({ excludedCommands: ["gh", ""] }, "f")).toThrow("non-empty");
    expect(() => parseSandboxSource([], "f")).toThrow("JSON object");
  });

  test("an `_note` beside the list is ignored, so the file can carry its own reasoning", () => {
    expect(parseSandboxSource({ _note: "why", excludedCommands: [] }, "f")).toEqual({
      excludedCommands: [],
    });
  });
});
