import { describe, expect, test } from "bun:test";
import { runHook } from "../../src/app/hooks/run-hook";
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

describe("runHook", () => {
  test("returns the decision and logs it, using a fake logger (no IO)", () => {
    const logger = new FakeLogger();
    const decision = runHook({ tool: "Bash", input: { command: "git push --force" } }, "standard", {
      logger,
    });
    expect(decision.kind).toBe("deny");
    expect(logger.entries.at(0)?.message).toBe("hook.decision");
    expect(logger.entries.at(0)?.meta?.decision).toBe("deny");
  });

  test("allows a benign command", () => {
    const logger = new FakeLogger();
    const decision = runHook({ tool: "Bash", input: { command: "echo hi" } }, "strict", { logger });
    expect(decision.kind).toBe("allow");
  });
});
