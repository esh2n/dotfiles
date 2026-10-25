import { describe, expect, test } from "bun:test";
import {
  type FindingsRule,
  type SkillRunEvent,
  checkFindings,
  findingsOf,
  findingsRuleOf,
  lastBlock,
} from "../../../src/domain/hooks/findings-check";

const RULE: FindingsRule = {
  reporters: ["code-reviewer", "test-reviewer"],
  verifier: "review-verifier",
};
const rules = (skill: string): FindingsRule | undefined =>
  skill === "change-review" ? RULE : undefined;

const S = "s1";
const skill = (at: string, name = "change-review", session = S): SkillRunEvent => ({
  at,
  session,
  harness: "claude",
  kind: "skill",
  name,
});
const sub = (
  at: string,
  agentType: string,
  findings: number | undefined,
  agentId?: string,
): SkillRunEvent => ({
  at,
  session: S,
  harness: "claude",
  kind: "subagent",
  agentType,
  ...(findings === undefined ? {} : { findings }),
  ...(agentId === undefined ? {} : { agentId }),
});
const gate = (
  at: string,
  useAt: string,
  outcome: "blocked" | "unverified" | "not-checked",
): SkillRunEvent => ({
  at,
  session: S,
  harness: "claude",
  kind: "gate",
  skill: "change-review",
  useAt,
  outcome,
});

const t = (n: number): string => `2026-10-23T10:00:${String(n).padStart(2, "0")}.000Z`;

describe("findingsOf: the reporter's last `Findings: <n>` line", () => {
  test("reads the count from the last line", () => {
    expect(findingsOf("## Findings\n1. x\n\nFindings: 3")).toBe(3);
  });
  test("the last such line wins when a report quotes an earlier one", () => {
    expect(findingsOf("Findings: 9\nmore\nFindings: 0\n")).toBe(0);
  });
  test("a report without the line has no count", () => {
    expect(findingsOf("No findings.")).toBeUndefined();
  });
  test("a heading named Findings is not the line", () => {
    expect(findingsOf("## Findings\nnone")).toBeUndefined();
  });
});

describe("findingsRuleOf: metadata.findings-reporters and findings-verifier", () => {
  test("a flow list and a scalar under metadata", () => {
    const front =
      "name: change-review\ndescription: x\nmetadata:\n  namespaces: [practice]\n  findings-reporters: [code-reviewer, test-reviewer]\n  findings-verifier: review-verifier";
    expect(findingsRuleOf(front)).toEqual(RULE);
  });
  test("a block list under metadata", () => {
    const front =
      "name: x\nmetadata:\n  findings-reporters:\n    - code-reviewer\n    - test-reviewer\n  findings-verifier: review-verifier\nother: y";
    expect(findingsRuleOf(front)).toEqual(RULE);
  });
  test("keys outside metadata are not the rule", () => {
    expect(
      findingsRuleOf("findings-reporters: [a]\nfindings-verifier: b\nmetadata:\n  namespaces: [x]"),
    ).toBeUndefined();
  });
  test("a half-declared rule is no rule", () => {
    expect(findingsRuleOf("metadata:\n  findings-reporters: [a]")).toBeUndefined();
    expect(findingsRuleOf("metadata:\n  findings-verifier: b")).toBeUndefined();
  });
  test("no metadata, no rule", () => {
    expect(findingsRuleOf("name: x\ndescription: y")).toBeUndefined();
  });
});

describe("checkFindings", () => {
  const check = (events: readonly SkillRunEvent[], running: readonly string[] = []) =>
    checkFindings({ session: S, events, rules, running });

  test("findings and a verifier after them: nothing to do", () => {
    expect(
      check([skill(t(1)), sub(t(2), "code-reviewer", 2), sub(t(3), "review-verifier", undefined)]),
    ).toEqual([]);
  });

  test("zero findings need no verifier", () => {
    expect(check([skill(t(1)), sub(t(2), "code-reviewer", 0)])).toEqual([]);
  });

  test("no reporter ran (a design review): nothing to do", () => {
    expect(check([skill(t(1)), sub(t(2), "spec-reviewer", undefined)])).toEqual([]);
  });

  test("findings without a verifier stop the turn, counted per reporter", () => {
    expect(
      check([skill(t(1)), sub(t(2), "code-reviewer", 2), sub(t(3), "test-reviewer", 1)]),
    ).toEqual([
      {
        action: "block",
        skill: "change-review",
        useAt: t(1),
        verifier: "review-verifier",
        findings: 3,
        reporters: [
          { agentType: "code-reviewer", findings: 2 },
          { agentType: "test-reviewer", findings: 1 },
        ],
        attempt: 1,
        cap: 2,
      },
    ]);
  });

  test("a verifier still running is not missing", () => {
    expect(check([skill(t(1)), sub(t(2), "code-reviewer", 2)], ["review-verifier"])).toEqual([]);
  });

  test("a verifier from before the skill's last use does not count", () => {
    const events = [
      skill(t(1)),
      sub(t(2), "code-reviewer", 1),
      sub(t(3), "review-verifier", undefined),
      skill(t(4)),
      sub(t(5), "code-reviewer", 1),
    ];
    expect(check(events).map((r) => [r.action, r.useAt])).toEqual([["block", t(4)]]);
  });

  test("the second stop for one use is attempt 2, the third tells the owner once", () => {
    const base = [skill(t(1)), sub(t(2), "code-reviewer", 1)];
    expect(
      check([...base, gate(t(3), t(1), "blocked")]).map((r) => [
        r.action,
        "attempt" in r ? r.attempt : undefined,
      ]),
    ).toEqual([["block", 2]]);
    const capped = [...base, gate(t(3), t(1), "blocked"), gate(t(4), t(1), "blocked")];
    expect(check(capped).map((r) => r.action)).toEqual(["unverified"]);
    expect(check([...capped, gate(t(5), t(1), "unverified")])).toEqual([]);
  });

  test("a reporter without the Findings line is 'not checked', said once, never a pass", () => {
    const events = [skill(t(1)), sub(t(2), "code-reviewer", undefined)];
    expect(
      check(events).map((r) => [r.action, "unreported" in r ? r.unreported : undefined]),
    ).toEqual([["not-checked", ["code-reviewer"]]]);
    expect(check([...events, gate(t(3), t(1), "not-checked")])).toEqual([]);
  });

  test("the handback and the stop of one subagent are one report", () => {
    const events = [
      skill(t(1)),
      sub(t(2), "code-reviewer", 2, "a1"),
      sub(t(3), "code-reviewer", undefined, "a1"),
    ];
    expect(check(events).map((r) => [r.action, "findings" in r ? r.findings : undefined])).toEqual([
      ["block", 2],
    ]);
  });

  test("a stop recorded before the hand-back still takes the hand-back's count", () => {
    const events = [
      skill(t(1)),
      sub(t(2), "code-reviewer", undefined, "a1"),
      sub(t(3), "code-reviewer", 2, "a1"),
    ];
    expect(check(events).map((r) => [r.action, "findings" in r ? r.findings : undefined])).toEqual([
      ["block", 2],
    ]);
  });

  test("two runs of one reporter type are two reports, summed", () => {
    const events = [
      skill(t(1)),
      sub(t(2), "code-reviewer", 1, "a1"),
      sub(t(3), "code-reviewer", 1, "a2"),
    ];
    expect(check(events).map((r) => ("findings" in r ? r.findings : undefined))).toEqual([2]);
  });

  test("while a reporter is still running, nothing is done and the cap is not spent", () => {
    expect(check([skill(t(1)), sub(t(2), "code-reviewer", 2)], ["test-reviewer"])).toEqual([]);
  });

  test("other sessions and skills without a rule are ignored", () => {
    expect(
      check([
        skill(t(1), "change-review", "other"),
        skill(t(1), "tdd-workflow"),
        sub(t(2), "code-reviewer", 4),
      ]),
    ).toEqual([]);
  });
});

describe("lastBlock: which gate stopped the session's turn last", () => {
  const typecheck = (at: string): SkillRunEvent => ({
    at,
    session: S,
    harness: "claude",
    kind: "typecheck",
  });
  test("the later of a findings block and a typecheck block", () => {
    expect(lastBlock(S, [gate(t(1), t(0), "blocked"), typecheck(t(2))])).toBe("typecheck");
    expect(lastBlock(S, [typecheck(t(1)), gate(t(2), t(0), "blocked")])).toBe("findings");
  });
  test("at one instant the later record wins; notices and other sessions are not blocks", () => {
    expect(lastBlock(S, [gate(t(1), t(0), "blocked"), typecheck(t(1))])).toBe("typecheck");
    expect(lastBlock(S, [gate(t(1), t(0), "unverified")])).toBeUndefined();
    expect(lastBlock("other", [typecheck(t(1))])).toBeUndefined();
  });
});
