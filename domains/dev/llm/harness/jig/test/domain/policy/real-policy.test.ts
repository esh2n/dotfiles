/**
 * Loads the REAL shared guard policy — `domains/dev/llm/harness/policy/guard-rules.json`,
 * the single source of truth pi's guard loader and jig's own PreToolUse hook
 * both read — and asserts the headline behaviors the Phase 1 unification
 * spec calls out explicitly. This is the one test in the suite that touches
 * the actual data file rather than a fixture, so a bad edit to the real
 * policy fails here, not only in a fixture-backed unit test.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate } from "../../../src/domain/policy/evaluate";
import { parsePolicy } from "../../../src/domain/policy/parse";

const REAL_POLICY_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "policy",
  "guard-rules.json",
);

describe("the real guard-rules.json", () => {
  test("parses clean", () => {
    const text = readFileSync(REAL_POLICY_PATH, "utf8");
    expect(() => parsePolicy(JSON.parse(text))).not.toThrow();
  });

  test("force-push is denied", () => {
    const policy = parsePolicy(JSON.parse(readFileSync(REAL_POLICY_PATH, "utf8")));
    const decision = evaluate(
      policy.rules,
      { tool: "Bash", input: { command: "git push --force origin main" } },
      "standard",
    );
    expect(decision.kind).toBe("deny");
  });

  test("git reset --hard is denied", () => {
    const policy = parsePolicy(JSON.parse(readFileSync(REAL_POLICY_PATH, "utf8")));
    const decision = evaluate(
      policy.rules,
      { tool: "Bash", input: { command: "git reset --hard" } },
      "standard",
    );
    expect(decision.kind).toBe("deny");
  });

  test("rm -rf x asks at standard", () => {
    const policy = parsePolicy(JSON.parse(readFileSync(REAL_POLICY_PATH, "utf8")));
    const decision = evaluate(
      policy.rules,
      { tool: "Bash", input: { command: "rm -rf x" } },
      "standard",
    );
    expect(decision.kind).toBe("ask");
  });

  test("sudo asks from standard up, allowed only at minimal", () => {
    const policy = parsePolicy(JSON.parse(readFileSync(REAL_POLICY_PATH, "utf8")));
    const standard = evaluate(
      policy.rules,
      { tool: "Bash", input: { command: "sudo ls" } },
      "standard",
    );
    const strict = evaluate(
      policy.rules,
      { tool: "Bash", input: { command: "sudo ls" } },
      "strict",
    );
    const minimal = evaluate(
      policy.rules,
      { tool: "Bash", input: { command: "sudo ls" } },
      "minimal",
    );
    // Ruling 2026-09-20: pi always confirmed sudo before unification, so the
    // shared policy must not weaken it — strength unifies upward.
    expect(minimal.kind).toBe("allow");
    expect(standard.kind).toBe("ask");
    expect(strict.kind).toBe("ask");
  });
});
