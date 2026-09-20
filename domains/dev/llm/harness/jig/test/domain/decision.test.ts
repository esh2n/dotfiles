/**
 * `decide()` is now a thin delegation to `domain/policy/evaluate.ts` — the
 * rules themselves live in data, not here. These cases are ported from the
 * pre-policy skeleton (force-push deny always, `rm -rf` confirm at standard
 * and above, `sudo` confirm at strict only) through a fixture policy whose
 * semantics are identical to the real
 * `domains/dev/llm/harness/policy/guard-rules.json` for these three rules —
 * see `test/cli/pre-tool-use.test.ts` for the case that loads the real file.
 */

import { describe, expect, test } from "bun:test";
import { type ToolCall, decide } from "../../src/domain/hooks/decision";
import { parsePolicy } from "../../src/domain/policy/parse";
import type { Policy } from "../../src/domain/policy/types";

const FIXTURE_POLICY: Policy = parsePolicy({
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
    {
      id: "rm-recursive-force",
      tier: "confirm",
      tools: ["shell"],
      match: "\\brm\\s+-rf\\b",
      why: "rm -rf requires confirmation",
      profiles: ["standard", "strict"],
    },
    {
      id: "sudo",
      tier: "confirm",
      tools: ["shell"],
      match: "\\bsudo\\b",
      why: "sudo under strict profile requires confirmation",
      profiles: ["strict"],
    },
  ],
});

const bash = (command: string): ToolCall => ({ tool: "Bash", input: { command } });

describe("decide", () => {
  test("allows a plain command", () => {
    expect(decide(bash("ls -la"), "standard", FIXTURE_POLICY)).toEqual({ kind: "allow" });
  });

  test("denies git force push on every profile", () => {
    for (const profile of ["minimal", "standard", "strict"] as const) {
      expect(decide(bash("git push --force origin main"), profile, FIXTURE_POLICY).kind).toBe(
        "deny",
      );
      expect(decide(bash("git push -f"), profile, FIXTURE_POLICY).kind).toBe("deny");
    }
  });

  test("asks before rm -rf on standard and above, allows on minimal", () => {
    expect(decide(bash("rm -rf build"), "minimal", FIXTURE_POLICY).kind).toBe("allow");
    expect(decide(bash("rm -rf build"), "standard", FIXTURE_POLICY).kind).toBe("ask");
    expect(decide(bash("rm -rf build"), "strict", FIXTURE_POLICY).kind).toBe("ask");
  });

  test("asks before sudo only under strict", () => {
    expect(decide(bash("sudo xcodebuild -license accept"), "standard", FIXTURE_POLICY).kind).toBe(
      "allow",
    );
    expect(decide(bash("sudo xcodebuild -license accept"), "strict", FIXTURE_POLICY).kind).toBe(
      "ask",
    );
  });

  test("ignores non-Bash tools", () => {
    expect(decide({ tool: "Read", input: { file_path: "/x" } }, "strict", FIXTURE_POLICY)).toEqual({
      kind: "allow",
    });
  });
});
