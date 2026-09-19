import { afterEach, describe, expect, test } from "bun:test";
import { preToolUse } from "../../src/cli/hooks/pre-tool-use";
import type { Logger } from "../../src/domain/ports";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function run(stdin: string): {
  permissionDecision: string;
  permissionDecisionReason?: string;
} {
  const out = JSON.parse(preToolUse(stdin, { logger: silentLogger })) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string };
  };
  return out.hookSpecificOutput;
}

afterEach(() => {
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.JIG_HOOK_PROFILE;
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.YOKI_HOOK_PROFILE;
});

describe("preToolUse", () => {
  test("a benign call is allowed, with no reason attached", () => {
    const decision = run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } }));

    expect(decision.permissionDecision).toBe("allow");
    expect(decision.permissionDecisionReason).toBeUndefined();
  });

  test("a force push is denied with the rule's reason", () => {
    const decision = run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force" } }),
    );

    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason).toMatch(/force push/);
  });

  test("unparseable stdin fails closed: ask, never allow", () => {
    const decision = run("not json at all {");

    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toMatch(/unparseable/i);
  });

  test("valid JSON without a tool_name fails closed: ask", () => {
    const decision = run(JSON.stringify({ tool_input: { command: "anything" } }));

    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toMatch(/tool_name/);
  });

  test("JIG_HOOK_PROFILE wins over the legacy YOKI_HOOK_PROFILE", () => {
    process.env.JIG_HOOK_PROFILE = "strict";
    process.env.YOKI_HOOK_PROFILE = "minimal";

    const decision = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "sudo ls" } }));

    expect(decision.permissionDecision).toBe("ask");
  });

  test("legacy YOKI_HOOK_PROFILE still applies while the fleet migrates", () => {
    process.env.YOKI_HOOK_PROFILE = "minimal";

    const decision = run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf build" } }),
    );

    expect(decision.permissionDecision).toBe("allow");
  });

  test("an unknown profile value normalizes to standard, not to a wider profile", () => {
    process.env.JIG_HOOK_PROFILE = "banana";

    const decision = run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf build" } }),
    );

    expect(decision.permissionDecision).toBe("ask");
  });
});
