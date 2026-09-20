import { describe, expect, test } from "bun:test";
import { NO_SKILL, type SkillCandidate, selectSkill } from "../../../src/app/routing/select-skill";
import type { Decided, DecisionProvider } from "../../../src/domain/decision/provider";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

/**
 * A provider that answers whatever label it was constructed with, including labels it
 * was not offered. `StaticProvider` refuses that (it validates against the options), but
 * a model-backed provider can name an option that is not there — which is the case the
 * router has to survive, since a skill name is about to be turned into a file path.
 */
class AnsweringProvider implements DecisionProvider {
  readonly name = "answering";

  constructor(
    private readonly label: string,
    private readonly confidence = 0.9,
  ) {}

  async choice<T extends string>(): Promise<Decided<T>> {
    return { value: this.label as T, confidence: this.confidence };
  }

  async bool(): Promise<Decided<boolean>> {
    throw new Error("selectSkill must ask one choice question");
  }

  async boolBatch(): Promise<readonly Decided<boolean>[]> {
    throw new Error("selectSkill must ask one choice question");
  }

  async score(): Promise<Decided<number>> {
    throw new Error("selectSkill must ask one choice question");
  }
}

const candidates: readonly SkillCandidate[] = [
  { name: "ui-capture", description: "screenshots of a web UI", path: "/skills/ui-capture" },
  { name: "writeup", description: "documents that are kept", path: "/skills/writeup" },
];

describe("selectSkill", () => {
  test("returns the candidate the judgment named", async () => {
    const provider = new StaticProvider({ choice: { value: "writeup", confidence: 0.93 } });

    const result = await selectSkill("turn this into a decision record", candidates, provider);

    expect(result.value?.name).toBe("writeup");
    expect(result.value?.path).toBe("/skills/writeup");
    expect(result.source).toBe("decided");
  });

  test("no candidate when the judgment answers none", async () => {
    const provider = new StaticProvider({ choice: { value: NO_SKILL, confidence: 0.99 } });

    const result = await selectSkill("what is the weather", candidates, provider);

    expect(result.value).toBeUndefined();
    // The answer was confident, so this is a decision, not a fallback: the router
    // consulted the judgment and it said nothing applies.
    expect(result.source).toBe("decided");
  });

  test("falls back to nothing when confidence is below the gate", async () => {
    const provider = new StaticProvider({ choice: { value: "ui-capture", confidence: 0.42 } });

    const result = await selectSkill("take a screenshot", candidates, provider);

    expect(result.value).toBeUndefined();
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBe(0.42);
  });

  test("keeps an answer whose name is not in the catalog out of the result", async () => {
    const result = await selectSkill("anything", candidates, new AnsweringProvider("ghost-skill"));

    expect(result.value).toBeUndefined();
  });

  test("asks nothing when there is no catalog", async () => {
    // A provider that would throw if consulted: an empty catalog must not spend a call.
    const provider = new StaticProvider({
      choice: { value: "ui-capture", confidence: 0.9 },
    });

    const result = await selectSkill("take a screenshot", [], provider);

    expect(result.value).toBeUndefined();
    expect(result.confidence).toBe(0);
  });
});
