import { describe, expect, test } from "bun:test";
import {
  type DshPreStepDecision,
  type DshStepMessage,
  humanText,
  routeStep,
} from "../../../adapters/dsh/src/skill";
import type { SkillDecision } from "../../../src/infra/decision/skill-client";

const root = { session: { header: {} } };
const sub = { session: { header: { origin: "subagent" as const } } };
const user = (text: string): DshStepMessage => ({
  source: { kind: "user" },
  content: [{ type: "text", text }],
});
const plugin = (text: string): DshStepMessage => ({
  source: { kind: "plugin" },
  content: [{ type: "text", text }],
});
const enter = async (): Promise<DshPreStepDecision> => ({ kind: "enter", messages: ["m0"] });
const matched: SkillDecision = {
  skills: [{ name: "go-testing", path: "/s/go-testing/SKILL.md", confidence: 0.9 }],
  passed: 1,
  source: "decided",
};

function asker(decision: SkillDecision | Error) {
  const prompts: string[] = [];
  const ask = async (_harness: string, prompt: string) => {
    prompts.push(prompt);
    if (decision instanceof Error) throw decision;
    return decision;
  };
  return { ask, prompts };
}

describe("humanText", () => {
  test("only the user's own text blocks", () => {
    expect(humanText([user("fix the test"), plugin("jig gate: tsc failed")])).toBe("fix the test");
  });
});

describe("routeStep", () => {
  test("a matched prompt appends one reminder after downstream's messages", async () => {
    const { ask, prompts } = asker(matched);
    const out = await routeStep({ agent: root, messages: [user("add a go test")] }, enter, {
      ask,
      env: {},
    });
    expect(prompts).toEqual(["add a go test"]);
    expect(out.kind).toBe("enter");
    if (out.kind !== "enter") return;
    expect(out.messages).toHaveLength(2);
    const reminder = out.messages[1] as { content: { text: string }[]; source: unknown };
    expect(reminder.content[0]?.text).toContain('- "go-testing": /s/go-testing/SKILL.md');
    expect(reminder.source).toEqual({ kind: "plugin", plugin: "jig-guard" });
  });

  test("a step that only carries the gate's steering is not judged", async () => {
    const { ask, prompts } = asker(matched);
    const out = await routeStep({ agent: root, messages: [plugin("jig gate: fix it")] }, enter, {
      ask,
      env: {},
    });
    expect(prompts).toHaveLength(0);
    expect(out).toEqual({ kind: "enter", messages: ["m0"] });
  });

  test("a subagent, a slash command, the off switch and a failing service all add nothing", async () => {
    const { ask, prompts } = asker(matched);
    await routeStep({ agent: sub, messages: [user("add a go test")] }, enter, { ask, env: {} });
    await routeStep({ agent: root, messages: [user("/goal x")] }, enter, { ask, env: {} });
    await routeStep({ agent: root, messages: [user("add a test")] }, enter, {
      ask,
      env: { DSH_SKILL_ROUTER: "off" },
    });
    expect(prompts).toHaveLength(0);
    const failing = asker(new Error("down"));
    const out = await routeStep({ agent: root, messages: [user("add a test")] }, enter, {
      ask: failing.ask,
      env: {},
    });
    expect(out).toEqual({ kind: "enter", messages: ["m0"] });
  });

  test("a rejected step stays rejected", async () => {
    const { ask } = asker(matched);
    const out = await routeStep(
      { agent: root, messages: [user("add a test")] },
      async () => ({ kind: "reject" }),
      { ask, env: {} },
    );
    expect(out).toEqual({ kind: "reject" });
  });
});
