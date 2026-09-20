import { describe, expect, test } from "bun:test";
import type { ToolCall } from "../../../src/domain/hooks/decision";
import { evaluate } from "../../../src/domain/policy/evaluate";
import { parsePolicy } from "../../../src/domain/policy/parse";
import type { GuardRule } from "../../../src/domain/policy/types";

function rules(...overrides: Array<Record<string, unknown>>): readonly GuardRule[] {
  const policy = parsePolicy({ version: 1, rules: overrides });
  if (policy.version !== 1) throw new Error("fixture is v1");
  return policy.rules;
}

const bash = (command: string): ToolCall => ({ tool: "Bash", input: { command } });
const write = (file_path: string): ToolCall => ({ tool: "Write", input: { file_path } });

describe("evaluate", () => {
  test("allows a call that matches no rule", () => {
    const decision = evaluate(
      rules({
        id: "sudo",
        tier: "confirm",
        tools: ["shell"],
        match: "\\bsudo\\b",
        why: "x",
        profiles: ["strict"],
      }),
      bash("ls -la"),
      "strict",
    );
    expect(decision).toEqual({ kind: "allow" });
  });

  test("a deny-tier match returns deny with the rule's why", () => {
    const rule = {
      id: "r",
      tier: "deny",
      tools: ["shell"],
      match: "\\brm\\s+-rf\\b",
      why: "no",
      profiles: ["minimal", "standard", "strict"],
    };
    const decision = evaluate(rules(rule), bash("rm -rf /"), "minimal");
    expect(decision).toEqual({ kind: "deny", reason: "no" });
  });

  test("a confirm-tier match returns ask with the rule's why", () => {
    const rule = {
      id: "r",
      tier: "confirm",
      tools: ["shell"],
      match: "\\bsudo\\b",
      why: "escalation",
      profiles: ["strict"],
    };
    const decision = evaluate(rules(rule), bash("sudo ls"), "strict");
    expect(decision).toEqual({ kind: "ask", reason: "escalation" });
  });

  test("a rule inactive in the current profile does not fire", () => {
    const rule = {
      id: "r",
      tier: "confirm",
      tools: ["shell"],
      match: "\\bsudo\\b",
      why: "escalation",
      profiles: ["strict"],
    };
    expect(evaluate(rules(rule), bash("sudo ls"), "standard")).toEqual({ kind: "allow" });
    expect(evaluate(rules(rule), bash("sudo ls"), "minimal")).toEqual({ kind: "allow" });
  });

  test("deny outranks confirm when both match the same call", () => {
    const denyRule = {
      id: "deny-r",
      tier: "deny",
      tools: ["shell"],
      match: "\\bsudo\\b",
      why: "denied",
      profiles: ["strict"],
    };
    const confirmRule = {
      id: "confirm-r",
      tier: "confirm",
      tools: ["shell"],
      match: "\\bsudo\\b",
      why: "confirm",
      profiles: ["strict"],
    };
    const decision = evaluate(rules(confirmRule, denyRule), bash("sudo ls"), "strict");
    expect(decision).toEqual({ kind: "deny", reason: "denied" });
  });

  test("Bash/bash/bash_background all alias to shell", () => {
    const rule = {
      id: "r",
      tier: "deny",
      tools: ["shell"],
      match: "\\bsudo\\b",
      why: "no",
      profiles: ["minimal", "standard", "strict"],
    };
    for (const tool of ["Bash", "bash", "bash_background"]) {
      expect(evaluate(rules(rule), { tool, input: { command: "sudo ls" } }, "minimal").kind).toBe(
        "deny",
      );
    }
  });

  test("a shell rule ignores a Write call even with a matching id", () => {
    const rule = {
      id: "r",
      tier: "deny",
      tools: ["shell"],
      match: "secrets\\.env",
      why: "no",
      profiles: ["minimal", "standard", "strict"],
    };
    expect(evaluate(rules(rule), write("/repo/secrets.env"), "minimal")).toEqual({ kind: "allow" });
  });

  test("Write/write, Edit/MultiEdit/edit alias to write/edit and match file_path", () => {
    const writeRule = {
      id: "w",
      tier: "deny",
      tools: ["write"],
      match: "\\.env$",
      why: "no secrets file",
      profiles: ["minimal", "standard", "strict"],
    };
    for (const tool of ["Write", "write"]) {
      expect(
        evaluate(rules(writeRule), { tool, input: { file_path: "/repo/.env" } }, "minimal").kind,
      ).toBe("deny");
    }

    const editRule = {
      id: "e",
      tier: "deny",
      tools: ["edit"],
      match: "\\.env$",
      why: "no secrets file",
      profiles: ["minimal", "standard", "strict"],
    };
    for (const tool of ["Edit", "MultiEdit", "edit"]) {
      expect(
        evaluate(rules(editRule), { tool, input: { file_path: "/repo/.env" } }, "minimal").kind,
      ).toBe("deny");
    }
  });

  test("an unmapped tool name always allows, regardless of rules", () => {
    const rule = {
      id: "r",
      tier: "deny",
      tools: ["shell"],
      match: ".*",
      why: "no",
      profiles: ["minimal", "standard", "strict"],
    };
    expect(evaluate(rules(rule), { tool: "Read", input: { file_path: "/x" } }, "strict")).toEqual({
      kind: "allow",
    });
  });

  test("a shell rule with no command field allows (nothing to match)", () => {
    const rule = {
      id: "r",
      tier: "deny",
      tools: ["shell"],
      match: ".*",
      why: "no",
      profiles: ["minimal", "standard", "strict"],
    };
    expect(evaluate(rules(rule), { tool: "Bash", input: {} }, "strict")).toEqual({ kind: "allow" });
  });
});
