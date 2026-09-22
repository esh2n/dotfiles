import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePolicy } from "../../../src/domain/policy/parse";
import { toClaudePermissions } from "../../../src/domain/policy/to-claude-permissions";
import type { Policy } from "../../../src/domain/policy/types";

const REAL_POLICY_PATH =
  process.env.JIG_REAL_POLICY_FILE ??
  join(import.meta.dir, "..", "..", "..", "..", "policy", "guard-rules.json");

function build(overrides: Record<string, unknown> = {}): Policy {
  return parsePolicy({ version: 1, rules: [], ...overrides });
}

function rule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "rule-1",
    effect: "forbid",
    action: "shell.exec",
    subject: { program: "git" },
    why: "test rule",
    profiles: ["standard", "strict"],
    ...overrides,
  };
}

function floor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "floor-1",
    action: "shell.exec",
    subject: { program: "rm" },
    why: "test floor rule",
    ...overrides,
  };
}

describe("toClaudePermissions", () => {
  test("program-only forbid converts to one Bash deny per alternative", () => {
    const policy = build({
      rules: [rule({ id: "power", subject: { program: "shutdown|reboot|halt" } })],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Bash(halt *)", "Bash(reboot *)", "Bash(shutdown *)"]);
    expect(result.allow).toEqual([]);
    expect(result.hookOnly).toEqual([]);
  });

  test("floor rules are always treated as forbid", () => {
    const policy = build({ floor: [floor({ id: "floor-power", subject: { program: "poweroff" } })] });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Bash(poweroff *)"]);
  });

  test("a literal ^-anchored argv converts to a combined Bash prefix", () => {
    const policy = build({
      rules: [rule({ id: "lms-load", subject: { program: "lms", argv: "^load\\b" } })],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Bash(lms load *)"]);
    expect(result.hookOnly).toEqual([]);
  });

  test("a simple anchored fs.write path converts to a Write deny glob", () => {
    const policy = build({
      rules: [
        rule({
          id: "no-env-write",
          action: "fs.write",
          subject: { path: "(?:^|/)\\.env$" },
        }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Write(**/.env)"]);
  });

  test("a simple anchored fs.edit path converts to an Edit deny glob", () => {
    const policy = build({
      rules: [
        rule({
          id: "no-env-edit",
          action: "fs.edit",
          subject: { path: "(?:^|/)\\.env$" },
        }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Edit(**/.env)"]);
  });

  test("a home-anchored literal path converts to an exact glob, no ** prefix", () => {
    const policy = build({
      rules: [
        rule({
          id: "no-aws-creds",
          action: "fs.write",
          subject: { path: "^~/\\.aws/credentials$" },
        }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Write(~/.aws/credentials)"]);
  });

  test("effect ask is always hook-only, even for an otherwise-simple shape", () => {
    const policy = build({
      rules: [rule({ id: "sudo", effect: "ask", subject: { program: "sudo" } })],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual([]);
    expect(result.allow).toEqual([]);
    expect(result.hookOnly).toEqual([{ id: "sudo", reason: expect.stringContaining("ask") }]);
  });

  test("a complex argv regex (lookahead) stays hook-only", () => {
    const policy = build({
      rules: [
        rule({
          id: "rm-rf",
          subject: {
            program: "rm",
            argv: "(?=.*(?:^|\\s)-[a-zA-Z]*r[a-zA-Z]*\\b)(?=.*(?:^|\\s)-[a-zA-Z]*f[a-zA-Z]*\\b)",
          },
        }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual([]);
    expect(result.hookOnly).toHaveLength(1);
    expect(result.hookOnly[0]?.id).toBe("rm-rf");
    expect(result.hookOnly[0]?.reason).toContain("argv");
  });

  test("a program regex with regex groups (not a plain alternation) stays hook-only", () => {
    const policy = build({
      rules: [rule({ id: "mkfs", subject: { program: "mkfs(\\..+)?|mke2fs" } })],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual([]);
    expect(result.hookOnly[0]?.reason).toContain("alternation");
  });

  test("a complex fs path regex stays hook-only", () => {
    const policy = build({
      rules: [
        rule({
          id: "policy-dir",
          action: "fs.write",
          subject: { path: "\\.config/jig/policy/|domains/dev/llm/harness/policy/" },
        }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual([]);
    expect(result.hookOnly[0]?.id).toBe("policy-dir");
  });

  test("effect permit converts to an allow entry, not a deny", () => {
    const policy = build({
      rules: [rule({ id: "permit-ls", effect: "permit", why: undefined, subject: { program: "ls" } })],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual([]);
    expect(result.allow).toEqual(["Bash(ls *)"]);
  });

  test("net.fetch and mcp.call are always hook-only", () => {
    const policy = build({
      rules: [
        rule({ id: "net-1", action: "net.fetch", subject: { host: "evil\\.example\\.com" } }),
        rule({ id: "mcp-1", action: "mcp.call", subject: { program: "some-server" } }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual([]);
    expect(result.hookOnly.map((h) => h.id).sort()).toEqual(["mcp-1", "net-1"]);
  });

  test("a raw match (string) rule is always hook-only", () => {
    const policy = build({
      rules: [
        rule({
          id: "fork-bomb",
          subject: undefined,
          match: "\\w+\\s*\\(\\s*\\)\\s*\\{",
        }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual([]);
    expect(result.hookOnly).toEqual([{ id: "fork-bomb", reason: expect.stringContaining("match") }]);
  });

  test("dedupes identical generated deny entries from different rules", () => {
    const policy = build({
      rules: [
        rule({ id: "a", subject: { program: "sudo" } }),
        rule({ id: "b", subject: { program: "sudo" } }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Bash(sudo *)"]);
  });

  test("output is stable-sorted", () => {
    const policy = build({
      rules: [
        rule({ id: "z", subject: { program: "zzz" } }),
        rule({ id: "a", subject: { program: "aaa" } }),
      ],
    });
    const result = toClaudePermissions(policy);
    expect(result.deny).toEqual(["Bash(aaa *)", "Bash(zzz *)"]);
  });

  test("the real live guard-rules.json parses and converts without throwing, and yields a non-empty deny list", () => {
    const policy = parsePolicy(JSON.parse(readFileSync(REAL_POLICY_PATH, "utf8")));
    const result = toClaudePermissions(policy);
    expect(result.deny.length).toBeGreaterThan(0);
    expect(Array.isArray(result.allow)).toBe(true);
    expect(result.hookOnly.length).toBeGreaterThan(0);
    // Every hookOnly rule id must be a real rule id in the policy.
    const allIds = new Set([...policy.floor.map((r) => r.id), ...policy.rules.map((r) => r.id)]);
    for (const entry of result.hookOnly) {
      expect(allIds.has(entry.id)).toBe(true);
    }
  });
});
