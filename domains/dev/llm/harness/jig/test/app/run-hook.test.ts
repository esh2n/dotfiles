import { describe, expect, test } from "bun:test";
import { runHook } from "../../src/app/hooks/run-hook";
import { parsePolicy } from "../../src/domain/policy/parse";
import type { Logger } from "../../src/domain/ports";

class FakeLogger implements Logger {
  readonly entries: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  debug(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ message, meta });
  }
  info(): void {}
  warn(): void {}
  error(): void {}
}

const POLICY = parsePolicy({
  version: 1,
  rules: [
    {
      id: "git-force-push",
      tier: "deny",
      tools: ["shell"],
      match: "\\bgit\\s+push\\b[^|;&]*(--force|\\s-f\\b)",
      why: "force push is never allowed",
      profiles: ["minimal", "standard", "strict"],
    },
  ],
});

describe("runHook", () => {
  test("returns the decision and logs it, using a fake logger (no IO)", () => {
    const logger = new FakeLogger();
    const decision = runHook(
      { tool: "Bash", input: { command: "git push --force" } },
      "standard",
      POLICY,
      { logger },
    );
    expect(decision.kind).toBe("deny");
    expect(logger.entries.at(0)?.message).toBe("hook.decision");
    expect(logger.entries.at(0)?.meta?.decision).toBe("deny");
  });

  test("allows a benign command", () => {
    const logger = new FakeLogger();
    const decision = runHook({ tool: "Bash", input: { command: "echo hi" } }, "strict", POLICY, {
      logger,
    });
    expect(decision.kind).toBe("allow");
  });
});
