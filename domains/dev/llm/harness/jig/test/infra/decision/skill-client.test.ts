import { describe, expect, test } from "bun:test";
import {
  askSkill,
  readSkillDecision,
  routable,
  serviceBase,
  skillReminder,
} from "../../../src/infra/decision/skill-client";

const DECISION = {
  skills: [{ name: "go-testing", path: "/s/go-testing/SKILL.md", confidence: 0.91 }],
  passed: 1,
  source: "decided",
};

describe("skill client", () => {
  test("reads a well-formed reply and refuses a malformed one", () => {
    expect(readSkillDecision(DECISION).skills[0]?.name).toBe("go-testing");
    expect(() => readSkillDecision({ skills: "x", passed: 1, source: "decided" })).toThrow();
    expect(() => readSkillDecision({ ...DECISION, source: "guess" })).toThrow();
  });

  test('the reminder keeps the report\'s `- "<name>": <path>` lines', () => {
    const text = skillReminder(readSkillDecision(DECISION), "omp");
    expect(text).toContain("1 skill matches this request (judgment confidence 0.91)");
    expect(text).toContain('- "go-testing": /s/go-testing/SKILL.md');
    expect(text).toContain("Read and follow these before doing the work:");
  });

  test("nothing matched is no reminder", () => {
    expect(skillReminder({ skills: [], passed: 0, source: "decided" }, "dsh")).toBeUndefined();
  });

  test("slash commands and empty prompts are not routed", () => {
    expect(routable("  ")).toBe(false);
    expect(routable("/tier complex")).toBe(false);
    expect(routable("add a test for the parser")).toBe(true);
  });

  test("the service base drops an endpoint suffix", () => {
    expect(serviceBase({ JIG_DECISION_URL: "http://127.0.0.1:4100/decide" })).toBe(
      "http://127.0.0.1:4100",
    );
    expect(serviceBase({})).toBe("http://127.0.0.1:4100");
  });

  test("posts the harness and prompt to /skill, and throws on a non-OK answer", async () => {
    const seen: { url: string; body: string }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body) });
      return new Response(JSON.stringify(DECISION), { status: 200 });
    }) as unknown as typeof fetch;
    const env = { JIG_DECISION_TOKEN_FILE: "/nonexistent/token" };
    const decision = await askSkill("dsh", "write a test", { env, fetch: ok });
    expect(decision.passed).toBe(1);
    expect(seen[0]?.url).toBe("http://127.0.0.1:4100/skill");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ harness: "dsh", prompt: "write a test" });

    const denied = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    await expect(askSkill("dsh", "x", { env, fetch: denied })).rejects.toThrow(/401/);
  });
});
