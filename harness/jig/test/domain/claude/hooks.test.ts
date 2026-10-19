import { describe, expect, test } from "bun:test";
import {
  CLAUDE_HOOK_EVENTS,
  SHARED_WRITE_MCP_MATCHER,
  buildClaudeHooks,
} from "../../../src/domain/claude/hooks";
import { HOST_SANDBOX } from "../../../src/domain/claude/sandbox";

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

  test("the guard sees every Notion tool; the rule tells reads from writes (ask-mcp-shared-write)", () => {
    const hooks = buildClaudeHooks(PATHS);
    const pre = (hooks.PreToolUse as { matcher: string }[])[0]?.matcher ?? "(?!)";
    const fires = (tool: string) => new RegExp(`^(?:${pre})$`).test(tool);
    for (const tool of [
      "mcp__claude_ai_Notion__notion-create-pages",
      "mcp__notion-mcp__notion-delete-pages",
      "mcp__claude_ai_Notion__notion-some-future-tool",
      "mcp__claude_ai_Notion__notion-fetch",
      "mcp__notion-mcp__notion-get-comments",
    ]) {
      expect(fires(tool)).toBe(true);
    }
    expect(fires("mcp__claude_ai_Gmail__authenticate")).toBe(false);
  });

  test("the shared-write matcher has no lookaround — Codex compiles matchers with Rust's regex crate", () => {
    expect(SHARED_WRITE_MCP_MATCHER).not.toMatch(/\(\?<?[=!]/);
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
  test("says off in so many words (rules/decisions/2026-09-30-host-claude-without-os-sandbox.md)", () => {
    expect(HOST_SANDBOX).toEqual({ enabled: false });
  });
});
