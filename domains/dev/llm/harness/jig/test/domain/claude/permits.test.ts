import { describe, expect, test } from "bun:test";
import { DEFAULT_PERMITS, defaultPermitPolicyFragment } from "../../../src/domain/claude/permits";
import { parsePolicy } from "../../../src/domain/policy/parse";
import { toClaudePermissions } from "../../../src/domain/policy/to-claude-permissions";

/** The fragment, pasted where the dry-run says to paste it. */
function projectFragment(): readonly string[] {
  const policy = parsePolicy({
    version: 1,
    floor: [],
    rules: JSON.parse(defaultPermitPolicyFragment()) as unknown[],
  } as Record<string, unknown>);
  return toClaudePermissions(policy).allow;
}

describe("the fallback and the policy fragment are the same decision, twice", () => {
  test("the fragment parses as a real guard policy", () => {
    expect(() => projectFragment()).not.toThrow();
  });

  test("projecting it yields exactly the fallback rules — so pasting changes nothing", () => {
    expect(projectFragment()).toEqual([...DEFAULT_PERMITS.map((p) => p.rule)].sort());
  });

  test("every id is unique, so a pasted rule collapses with its fallback and does not double", () => {
    const ids = DEFAULT_PERMITS.map((permit) => permit.policyRule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the decision's three kinds plus the static checks, and nothing broader", () => {
  test("git commit, git push, four test runners, and the four static checks the hooks never run", () => {
    expect(DEFAULT_PERMITS.map((permit) => permit.rule)).toEqual([
      "Bash(git commit *)",
      "Bash(git push *)",
      "Bash(npm test *)",
      "Bash(go test *)",
      "Bash(pytest *)",
      "Bash(bun test *)",
      "Bash(staticcheck *)",
      "Bash(cargo clippy *)",
      "Bash(stylelint *)",
      "Bash(html-validate *)",
    ]);
  });

  test("each static-check permit names the ruling that keeps it out of the hooks", () => {
    const ruling = "2026-09-23-hooks-carry-formatters-only-stylelint-added";
    const checks = DEFAULT_PERMITS.filter((permit) =>
      [
        "permit-staticcheck",
        "permit-cargo-clippy",
        "permit-stylelint",
        "permit-html-validate",
      ].includes(permit.policyRule.id),
    );
    expect(checks).toHaveLength(4);
    for (const permit of checks) expect(permit.policyRule.why).toContain(ruling);
  });

  test("cargo clippy is the subcommand, not cargo as a whole", () => {
    const clippy = DEFAULT_PERMITS.find((permit) => permit.policyRule.id === "permit-cargo-clippy");
    expect(clippy?.policyRule.subject).toEqual({ program: "cargo", argv: "^clippy\\b" });
    expect(DEFAULT_PERMITS.map((permit) => permit.rule)).not.toContain("Bash(cargo *)");
  });

  test("no broad shape: no bare interpreter, no package-manager run, no Bash(*)", () => {
    for (const permit of DEFAULT_PERMITS) {
      expect(permit.rule).not.toBe("Bash(*)");
      expect(permit.rule).not.toMatch(/^Bash\((?:node|python3?|sh|bash|ruby|perl) \*\)$/);
      expect(permit.rule).not.toMatch(/ run \*\)$/);
    }
  });

  test("every permit is shell.exec with an effect of permit — never a forbid in disguise", () => {
    for (const permit of DEFAULT_PERMITS) {
      expect(permit.policyRule.effect).toBe("permit");
      expect(permit.policyRule.action).toBe("shell.exec");
      expect(permit.policyRule.profiles).toEqual(["minimal", "standard", "strict"]);
    }
  });
});
