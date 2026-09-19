/**
 * Strict validation for the shared guard policy document. Cases tagged
 * [policy-verified] pin the schema described in the Phase 1 guard-policy
 * unification spec: `version` must be 1, every rule needs id/tier/tools/
 * match/why/profiles, tier is "deny"|"confirm", tools are drawn from
 * "shell"|"write"|"edit", profiles from "minimal"|"standard"|"strict", and
 * an invalid regex in `match` is a parse-time error, not an evaluate-time
 * surprise.
 */

import { describe, expect, test } from "bun:test";
import { parsePolicy } from "../../../src/domain/policy/parse";

function validRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "git-force-push",
    tier: "deny",
    tools: ["shell"],
    match: "\\bgit\\s+push\\b.*--force",
    why: "force push is never recoverable",
    profiles: ["minimal", "standard", "strict"],
    ...overrides,
  };
}

describe("parsePolicy", () => {
  test("[policy-verified] parses a well-formed policy", () => {
    const policy = parsePolicy({ version: 1, rules: [validRule()] });
    expect(policy.version).toBe(1);
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0]?.id).toBe("git-force-push");
    expect(policy.rules[0]?.tier).toBe("deny");
    expect(policy.rules[0]?.tools).toEqual(["shell"]);
    expect(policy.rules[0]?.why).toBe("force push is never recoverable");
    expect(policy.rules[0]?.profiles).toEqual(["minimal", "standard", "strict"]);
  });

  test("[policy-verified] compiles match into a real RegExp", () => {
    const policy = parsePolicy({ version: 1, rules: [validRule()] });
    expect(policy.rules[0]?.match).toBeInstanceOf(RegExp);
    expect(policy.rules[0]?.match.test("git push --force origin main")).toBe(true);
    expect(policy.rules[0]?.match.test("git status")).toBe(false);
  });

  test("[policy-verified] an empty rules array is valid", () => {
    const policy = parsePolicy({ version: 1, rules: [] });
    expect(policy.rules).toEqual([]);
  });

  test("[policy-verified] a confirm-tier, single-profile rule parses", () => {
    const policy = parsePolicy({
      version: 1,
      rules: [
        validRule({ id: "sudo", tier: "confirm", match: "\\bsudo\\b", profiles: ["strict"] }),
      ],
    });
    expect(policy.rules[0]?.tier).toBe("confirm");
    expect(policy.rules[0]?.profiles).toEqual(["strict"]);
  });

  test("[policy-verified] top level must be an object", () => {
    expect(() => parsePolicy(null)).toThrow(/expected a JSON object/);
    expect(() => parsePolicy([])).toThrow(/expected a JSON object/);
    expect(() => parsePolicy("nope")).toThrow(/expected a JSON object/);
  });

  test("[policy-verified] version must be exactly 1", () => {
    expect(() => parsePolicy({ version: 2, rules: [] })).toThrow(/unsupported version/);
    expect(() => parsePolicy({ version: "1", rules: [] })).toThrow(/unsupported version/);
    expect(() => parsePolicy({ rules: [] })).toThrow(/unsupported version/);
  });

  test('[policy-verified] "rules" must be an array', () => {
    expect(() => parsePolicy({ version: 1, rules: "nope" })).toThrow(/"rules" must be an array/);
    expect(() => parsePolicy({ version: 1 })).toThrow(/"rules" must be an array/);
  });

  test("[policy-verified] a rule must be an object", () => {
    expect(() => parsePolicy({ version: 1, rules: ["nope"] })).toThrow(
      /rules\[0\] must be an object/,
    );
  });

  test("[policy-verified] a rule needs a non-empty string id", () => {
    expect(() => parsePolicy({ version: 1, rules: [validRule({ id: "" })] })).toThrow(/"id"/);
    expect(() => parsePolicy({ version: 1, rules: [validRule({ id: undefined })] })).toThrow(
      /"id"/,
    );
  });

  test("[policy-verified] an unknown tier throws, naming the rule", () => {
    expect(() => parsePolicy({ version: 1, rules: [validRule({ tier: "warn" })] })).toThrow(
      /rule "git-force-push" has unknown tier "warn"/,
    );
  });

  test("[policy-verified] tools must be a non-empty array of known tools", () => {
    expect(() => parsePolicy({ version: 1, rules: [validRule({ tools: [] })] })).toThrow(
      /non-empty "tools" array/,
    );
    expect(() => parsePolicy({ version: 1, rules: [validRule({ tools: ["network"] })] })).toThrow(
      /unknown tool "network"/,
    );
  });

  test("[policy-verified] match must be a non-empty string", () => {
    expect(() => parsePolicy({ version: 1, rules: [validRule({ match: "" })] })).toThrow(/"match"/);
    expect(() => parsePolicy({ version: 1, rules: [validRule({ match: 42 })] })).toThrow(/"match"/);
  });

  test("[policy-verified] an invalid match regex is a parse error", () => {
    expect(() => parsePolicy({ version: 1, rules: [validRule({ match: "(unclosed" })] })).toThrow(
      /invalid "match" regex/,
    );
  });

  test("[policy-verified] why must be a non-empty string", () => {
    expect(() => parsePolicy({ version: 1, rules: [validRule({ why: "" })] })).toThrow(/"why"/);
  });

  test("[policy-verified] profiles must be a non-empty array of known profiles", () => {
    expect(() => parsePolicy({ version: 1, rules: [validRule({ profiles: [] })] })).toThrow(
      /non-empty "profiles" array/,
    );
    expect(() =>
      parsePolicy({ version: 1, rules: [validRule({ profiles: ["relaxed"] })] }),
    ).toThrow(/unknown profile "relaxed"/);
  });
});
