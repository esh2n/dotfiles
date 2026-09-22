import { describe, expect, test } from "bun:test";
import { parsePolicy } from "../../../src/domain/policy/parse";
import type { Policy } from "../../../src/domain/policy/types";

function build(overrides: Record<string, unknown> = {}): Policy {
  const policy = parsePolicy({ version: 1, rules: [], ...overrides });
  if (policy.version !== 1) throw new Error("expected the guard policy");
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

describe("parsePolicy", () => {
  test("parses the documented shape", () => {
    const policy = build({
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
      "fs.read": "allowlist",
      "net.fetch": "denylist",
      "mcp.call": "denylist",
    });
    expect(policy.rules).toHaveLength(2);
    expect(policy.rules[0]?.subject?.argv).toBeInstanceOf(RegExp);
    expect(policy.rules[0]?.subject?.program?.source).toBe("^(?:git)$");
    expect(policy.rules[1]?.effect).toBe("permit");
  });

  test("mode defaults to denylist for every action", () => {
    expect(Object.values(build().mode)).toEqual([
      "denylist",
      "denylist",
      "denylist",
      "denylist",
      "denylist",
      "denylist",
    ]);
  });

  test("a forbid or ask must say why; a permit need not", () => {
    expect(() => build({ rules: [rule({ why: undefined })] })).toThrow(/must carry a "why"/);
    expect(() => build({ rules: [rule({ effect: "ask", why: undefined })] })).toThrow(
      /must carry a "why"/,
    );
    expect(
      build({ rules: [rule({ effect: "permit", why: undefined })] }).rules[0]?.why,
    ).toBeUndefined();
  });

  test("a rule needs a subject or a match", () => {
    expect(() => build({ rules: [rule({ subject: undefined })] })).toThrow(
      /needs a "subject" or a "match"/,
    );
    expect(
      build({ rules: [rule({ subject: undefined, match: "--force" })] }).rules[0]?.match,
    ).toBeInstanceOf(RegExp);
  });

  test("unknown effect, action, profile, mode, subject field are refused", () => {
    expect(() => build({ rules: [rule({ effect: "deny" })] })).toThrow(/unknown effect "deny"/);
    expect(() => build({ rules: [rule({ action: "shell" })] })).toThrow(/unknown action "shell"/);
    expect(() => build({ rules: [rule({ profiles: ["max"] })] })).toThrow(/unknown profile "max"/);
    expect(() => build({ mode: { shell: "open" } })).toThrow(/expected denylist or allowlist/);
    expect(() => build({ mode: { gui: "denylist" } })).toThrow(/unknown key "gui"/);
    expect(() => build({ rules: [rule({ subject: { command: "git" } })] })).toThrow(
      /unknown subject field "command"/,
    );
    expect(() => build({ rules: [rule({ subject: {} })] })).toThrow(/empty "subject"/);
  });

  test("regexes are compiled at parse time; a bad one is a parse error", () => {
    expect(() => build({ rules: [rule({ subject: { program: "git", argv: "(" } })] })).toThrow(
      /invalid "subject.argv" regex/,
    );
    expect(() => build({ rules: [rule({ subject: { program: "(" } })] })).toThrow(
      /invalid "subject.program" regex/,
    );
    expect(() => build({ rules: [rule({ match: "[" })] })).toThrow(/invalid "match" regex/);
  });

  test("principals is optional but must be a non-empty list of names when present", () => {
    expect(build({ rules: [rule({ principals: ["pi", "dsh"] })] }).rules[0]?.principals).toEqual([
      "pi",
      "dsh",
    ]);
    expect(() => build({ rules: [rule({ principals: [] })] })).toThrow(/principals/);
    expect(() => build({ rules: [rule({ principals: "pi" })] })).toThrow(/principals/);
  });

  test("a floor rule carries no effect, profiles or principals: it is forbid, everywhere", () => {
    const floor = { id: "f", action: "shell.exec", subject: { program: "mkfs" }, why: "no" };
    expect(build({ floor: [floor] }).floor[0]?.why).toBe("no");
    expect(() => build({ floor: [{ ...floor, effect: "forbid" }] })).toThrow(
      /must not carry "effect"/,
    );
    expect(() => build({ floor: [{ ...floor, profiles: ["strict"] }] })).toThrow(
      /must not carry "profiles"/,
    );
    expect(() => build({ floor: [{ ...floor, why: undefined }] })).toThrow(
      /missing a non-empty string "why"/,
    );
  });

  test("ids are unique across floor and rules", () => {
    expect(() =>
      build({
        floor: [{ id: "dup", action: "shell.exec", subject: { program: "mkfs" }, why: "no" }],
        rules: [rule({ id: "dup" })],
      }),
    ).toThrow(/duplicate rule id "dup"/);
  });
});

describe("version tolerance during migration", () => {
  test("version 2 is accepted as a deprecated alias, normalized to 1", () => {
    const parsed = parsePolicy({ version: 2, rules: [rule()] });
    expect(parsed.version).toBe(1);
  });

  test("an unsupported version is refused", () => {
    expect(() => parsePolicy({ version: 3, rules: [] })).toThrow(/unsupported version/);
    expect(() => parsePolicy({ rules: [] })).toThrow(/unsupported version/);
  });
});
