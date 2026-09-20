import { describe, expect, test } from "bun:test";
import { parsePolicy } from "../../../../src/domain/policy/parse";
import type { PolicyV2 } from "../../../../src/domain/policy/v2/types";

function v2(overrides: Record<string, unknown> = {}): PolicyV2 {
  const policy = parsePolicy({ version: 2, rules: [], ...overrides });
  if (policy.version !== 2) throw new Error("expected v2");
  return policy;
}

function rule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "deny-force-push",
    effect: "forbid",
    action: "shell.exec",
    subject: { program: "git", argv: "^push\\b.*--force" },
    why: "force push is not recoverable",
    profiles: ["standard", "strict"],
    ...overrides,
  };
}

describe("parsePolicy v2", () => {
  test("parses the documented shape", () => {
    const policy = v2({
      floor: [
        {
          id: "floor-rm-root",
          action: "shell.exec",
          subject: { program: "rm", argv: "(^|\\s)-[a-zA-Z]*r[a-zA-Z]*f?\\s+/(\\s|$)" },
          why: "recursive delete of /",
        },
      ],
      mode: { shell: "denylist", fs: "allowlist" },
      rules: [
        rule(),
        rule({ id: "permit-ls", effect: "permit", subject: { program: "ls" }, why: undefined }),
      ],
    });
    expect(policy.floor).toHaveLength(1);
    expect(policy.floor[0]?.id).toBe("floor-rm-root");
    expect(policy.mode).toEqual({
      "shell.exec": "denylist",
      "fs.write": "allowlist",
      "fs.edit": "allowlist",
      "net.fetch": "denylist",
      "mcp.call": "denylist",
    });
    expect(policy.rules).toHaveLength(2);
    expect(policy.rules[0]?.subject?.argv).toBeInstanceOf(RegExp);
    expect(policy.rules[0]?.subject?.program?.source).toBe("^(?:git)$");
    expect(policy.rules[1]?.effect).toBe("permit");
  });

  test("mode defaults to denylist for every action", () => {
    expect(Object.values(v2().mode)).toEqual([
      "denylist",
      "denylist",
      "denylist",
      "denylist",
      "denylist",
    ]);
  });

  test("a forbid or ask must say why; a permit need not", () => {
    expect(() => v2({ rules: [rule({ why: undefined })] })).toThrow(/must carry a "why"/);
    expect(() => v2({ rules: [rule({ effect: "ask", why: undefined })] })).toThrow(
      /must carry a "why"/,
    );
    expect(
      v2({ rules: [rule({ effect: "permit", why: undefined })] }).rules[0]?.why,
    ).toBeUndefined();
  });

  test("a rule needs a subject or a match", () => {
    expect(() => v2({ rules: [rule({ subject: undefined })] })).toThrow(
      /needs a "subject" or a "match"/,
    );
    expect(
      v2({ rules: [rule({ subject: undefined, match: "--force" })] }).rules[0]?.match,
    ).toBeInstanceOf(RegExp);
  });

  test("unknown effect, action, profile, mode, subject field are refused", () => {
    expect(() => v2({ rules: [rule({ effect: "deny" })] })).toThrow(/unknown effect "deny"/);
    expect(() => v2({ rules: [rule({ action: "shell" })] })).toThrow(/unknown action "shell"/);
    expect(() => v2({ rules: [rule({ profiles: ["max"] })] })).toThrow(/unknown profile "max"/);
    expect(() => v2({ mode: { shell: "open" } })).toThrow(/expected denylist or allowlist/);
    expect(() => v2({ mode: { gui: "denylist" } })).toThrow(/unknown key "gui"/);
    expect(() => v2({ rules: [rule({ subject: { command: "git" } })] })).toThrow(
      /unknown subject field "command"/,
    );
    expect(() => v2({ rules: [rule({ subject: {} })] })).toThrow(/empty "subject"/);
  });

  test("regexes are compiled at parse time; a bad one is a parse error", () => {
    expect(() => v2({ rules: [rule({ subject: { program: "git", argv: "(" } })] })).toThrow(
      /invalid "subject.argv" regex/,
    );
    expect(() => v2({ rules: [rule({ subject: { program: "(" } })] })).toThrow(
      /invalid "subject.program" regex/,
    );
    expect(() => v2({ rules: [rule({ match: "[" })] })).toThrow(/invalid "match" regex/);
  });

  test("principals is optional but must be a non-empty list of names when present", () => {
    expect(v2({ rules: [rule({ principals: ["pi", "dsh"] })] }).rules[0]?.principals).toEqual([
      "pi",
      "dsh",
    ]);
    expect(() => v2({ rules: [rule({ principals: [] })] })).toThrow(/principals/);
    expect(() => v2({ rules: [rule({ principals: "pi" })] })).toThrow(/principals/);
  });

  test("a floor rule carries no effect, profiles or principals: it is forbid, everywhere", () => {
    const floor = { id: "f", action: "shell.exec", subject: { program: "mkfs" }, why: "no" };
    expect(v2({ floor: [floor] }).floor[0]?.why).toBe("no");
    expect(() => v2({ floor: [{ ...floor, effect: "forbid" }] })).toThrow(
      /must not carry "effect"/,
    );
    expect(() => v2({ floor: [{ ...floor, profiles: ["strict"] }] })).toThrow(
      /must not carry "profiles"/,
    );
    expect(() => v2({ floor: [{ ...floor, why: undefined }] })).toThrow(
      /missing a non-empty string "why"/,
    );
  });

  test("ids are unique across floor and rules", () => {
    expect(() =>
      v2({
        floor: [{ id: "dup", action: "shell.exec", subject: { program: "mkfs" }, why: "no" }],
        rules: [rule({ id: "dup" })],
      }),
    ).toThrow(/duplicate rule id "dup"/);
  });
});
