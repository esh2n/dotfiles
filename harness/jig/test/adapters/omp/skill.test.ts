import { describe, expect, test } from "bun:test";
import { routeSkill } from "../../../adapters/omp/src/skill";
import {
  type SkillDecision,
  routable,
  skillReminder,
} from "../../../src/infra/decision/skill-client";

const matched: SkillDecision = {
  skills: [{ name: "rust-patterns", path: "/s/rust-patterns/SKILL.md", confidence: 0.88 }],
  passed: 1,
  source: "decided",
};

function client(decision: SkillDecision | Error) {
  const asked: string[] = [];
  return {
    asked,
    client: {
      routable,
      skillReminder,
      askSkill: async (harness: string, prompt: string) => {
        asked.push(`${harness}:${prompt}`);
        if (decision instanceof Error) throw decision;
        return decision;
      },
    },
  };
}

const statuses: string[] = [];
const ctx = { cwd: "/p", ui: { setStatus: (m: string) => statuses.push(m) } } as never;

describe("routeSkill (omp)", () => {
  test("a matched prompt returns one hidden message with the reminder", async () => {
    const c = client(matched);
    const out = await routeSkill({ prompt: "refactor this crate" }, ctx, {
      client: c.client,
      env: {},
    });
    expect(c.asked).toEqual(["omp:refactor this crate"]);
    expect(out?.message?.customType).toBe("jig-skill-router");
    expect(out?.message?.display).toBe(false);
    expect(out?.message?.content).toContain('- "rust-patterns": /s/rust-patterns/SKILL.md');
  });

  test("slash commands, the off switch, nothing matched and a failing service return nothing", async () => {
    const c = client(matched);
    expect(
      await routeSkill({ prompt: "/tier complex" }, ctx, { client: c.client, env: {} }),
    ).toBeUndefined();
    expect(
      await routeSkill({ prompt: "x" }, ctx, {
        client: c.client,
        env: { OMP_SKILL_ROUTER: "off" },
      }),
    ).toBeUndefined();
    const none = client({ skills: [], passed: 0, source: "decided" });
    expect(
      await routeSkill({ prompt: "x" }, ctx, { client: none.client, env: {} }),
    ).toBeUndefined();
    const down = client(new Error("down"));
    expect(
      await routeSkill({ prompt: "x" }, ctx, { client: down.client, env: {} }),
    ).toBeUndefined();
  });
});
