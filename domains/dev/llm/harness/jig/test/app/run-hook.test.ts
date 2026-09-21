import { describe, expect, test } from "bun:test";
import { type LoadedPolicy, policyHash, runHook } from "../../src/app/hooks/run-hook";
import type { AuditEntry } from "../../src/domain/policy/audit";
import { parsePolicy } from "../../src/domain/policy/parse";
import type { Principal } from "../../src/domain/policy/request";
import type { AuditLog, Logger } from "../../src/domain/ports";

class FakeLogger implements Logger {
  readonly entries: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  debug(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ message, meta });
  }
  info(): void {}
  warn(): void {}
  error(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ message, meta });
  }
}

class FakeAudit implements AuditLog {
  readonly entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const POLICY_TEXT = JSON.stringify({
  version: 1,
  rules: [
    {
      id: "git-force-push",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "git", argv: "push\\b.*(--force|(^|\\s)-f\\b)" },
      why: "force push is never allowed",
      profiles: ["minimal", "standard", "strict"],
    },
  ],
});
const POLICY: LoadedPolicy = {
  policy: parsePolicy(JSON.parse(POLICY_TEXT)),
  hash: policyHash(POLICY_TEXT),
};
const clock = { now: () => new Date("2026-09-21T00:00:00Z") };
const principal = (profile: Principal["profile"]): Principal => ({ harness: "test", profile });

describe("runHook", () => {
  test("returns the decision and logs it, using a fake logger (no IO)", async () => {
    const logger = new FakeLogger();
    const decision = await runHook(
      { tool: "Bash", input: { command: "git push --force" } },
      principal("standard"),
      POLICY,
      { logger, clock },
    );
    expect(decision.kind).toBe("deny");
    expect(logger.entries.at(0)?.message).toBe("hook.decision");
    expect(logger.entries.at(0)?.meta?.decision).toBe("deny");
  });

  test("allows a benign command", async () => {
    const logger = new FakeLogger();
    const decision = await runHook(
      { tool: "Bash", input: { command: "echo hi" } },
      principal("strict"),
      POLICY,
      { logger, clock },
    );
    expect(decision.kind).toBe("allow");
  });

  test("records every judgment in the audit log with who, what, why and the policy hash", async () => {
    const audit = new FakeAudit();
    const call = { tool: "Bash", input: { command: "git push --force" } };
    const who: Principal = { harness: "pi", profile: "standard", sessionId: "s1", cwd: "/w" };
    await runHook(call, who, POLICY, { logger: new FakeLogger(), clock, audit });
    await runHook({ tool: "Bash", input: { command: "echo hi" } }, who, POLICY, {
      logger: new FakeLogger(),
      clock,
      audit,
    });
    expect(audit.entries).toHaveLength(2);
    expect(audit.entries[0]).toMatchObject({
      ts: "2026-09-21T00:00:00.000Z",
      principal: who,
      tool: "Bash",
      decision: "deny",
      reason: "force push is never allowed",
      source: "rule",
      policy: { version: 1, hash: POLICY.hash },
    });
    expect(audit.entries[1]).toMatchObject({ decision: "allow", source: "none" });
  });

  test("an audit log that cannot be written does not change the decision", async () => {
    const logger = new FakeLogger();
    const broken: AuditLog = {
      append: async () => {
        throw new Error("disk full");
      },
    };
    const decision = await runHook(
      { tool: "Bash", input: { command: "git push --force" } },
      principal("standard"),
      POLICY,
      { logger, clock, audit: broken },
    );
    expect(decision.kind).toBe("deny");
  });
});
