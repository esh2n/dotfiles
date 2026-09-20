import { describe, expect, test } from "bun:test";
import type { SkillCandidate } from "../../../src/app/routing/select-skill";
import { selectSkills, skillQuestion } from "../../../src/app/routing/select-skills";
import type { Decided, DecisionProvider } from "../../../src/domain/decision/provider";

/**
 * A provider that answers one boolean per question from a table keyed by the skill the
 * question is about. Keying by the question text rather than by position is deliberate:
 * the gate and the cap are the behaviour under test, and a positional fake would pass
 * even if the questions were asked in a different order than the answers were built.
 */
class TableProvider implements DecisionProvider {
  readonly name = "table";
  readonly asked: string[] = [];

  constructor(
    private readonly candidates: readonly SkillCandidate[],
    private readonly answers: ReadonlyMap<string, Decided<boolean>>,
  ) {}

  private answerFor(question: string): Decided<boolean> {
    for (const [name, answer] of this.answers) {
      if (question.includes(`「${name}」`)) return answer;
    }
    return { value: false, confidence: 1 };
  }

  async choice<T extends string>(): Promise<Decided<T>> {
    throw new Error("selectSkills must ask a batch, not a choice question");
  }

  async bool(): Promise<Decided<boolean>> {
    throw new Error("selectSkills must ask a batch, not a single boolean");
  }

  async boolBatch(): Promise<readonly Decided<boolean>[]> {
    return this.candidates.map((candidate) => {
      this.asked.push(candidate.name);
      return this.answerFor(skillQuestion(candidate));
    });
  }

  async score(): Promise<Decided<number>> {
    throw new Error("selectSkills must ask a batch, not a score");
  }
}

const candidates: readonly SkillCandidate[] = [
  { name: "ui-capture", description: "screenshots of a web UI", path: "/skills/ui-capture" },
  { name: "writeup", description: "documents that are kept", path: "/skills/writeup" },
  { name: "golang-patterns", description: "Go idioms", path: "/skills/golang-patterns" },
];

/** A provider that answers every question, so nothing depends on how a partial batch behaves. */
function providerFor(answers: ReadonlyMap<string, Decided<boolean>>): TableProvider {
  return new TableProvider(candidates, answers);
}

function answers(entries: readonly (readonly [string, boolean, number])[]) {
  return new Map(entries.map(([name, value, confidence]) => [name, { value, confidence }]));
}

describe("selectSkills", () => {
  test("keeps every candidate that cleared the gate, strongest confidence first", async () => {
    const result = await selectSkills(
      "この設計をレビューして",
      candidates,
      providerFor(
        answers([
          ["writeup", true, 0.85],
          ["ui-capture", true, 0.95],
        ]),
      ),
    );

    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["ui-capture", "writeup"]);
    expect(result.picks.map((pick) => pick.confidence)).toEqual([0.95, 0.85]);
    expect(result.source).toBe("decided");
    expect(result.passed).toBe(2);
  });

  test("drops a true that did not clear the gate, and says how many did", async () => {
    const result = await selectSkills(
      "何かの依頼",
      candidates,
      providerFor(
        answers([
          ["ui-capture", true, 0.79],
          ["writeup", true, 0.61],
        ]),
      ),
    );

    // The measured batch puts the candidates that do not apply at 0.5-0.6, so the gate is
    // what separates them; `passed` counts what is left after the gate so a saturating
    // batch (everything at 1.0) is visible rather than silently truncated.
    expect(result.picks).toEqual([]);
    expect(result.source).toBe("fallback");
    expect(result.passed).toBe(0);
  });

  test("asks about every candidate, and caps how many are handed over", async () => {
    const all = answers(
      candidates.map((candidate, index) => [candidate.name, true, 0.9 - index * 0.01] as const),
    );
    const provider = providerFor(all);
    const result = await selectSkills("何かの依頼", candidates, provider, {}, { max: 2 });

    expect(provider.asked).toEqual(["ui-capture", "writeup", "golang-patterns"]);
    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["ui-capture", "writeup"]);
    // The cap is a display limit, not a judgment: how many cleared the gate is still reported.
    expect(result.passed).toBe(3);
  });

  test("keeps the catalog's order for equal confidence, so the same answer gives the same picks", async () => {
    const result = await selectSkills(
      "何かの依頼",
      candidates,
      providerFor(
        answers([
          ["golang-patterns", true, 0.9],
          ["ui-capture", true, 0.9],
          ["writeup", true, 0.9],
        ]),
      ),
      {},
      { max: 2 },
    );

    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["ui-capture", "writeup"]);
  });

  test("asks nothing when there is nothing to ask about", async () => {
    const provider = providerFor(new Map());
    expect(await selectSkills("何かの依頼", [], provider)).toEqual({
      picks: [],
      passed: 0,
      source: "fallback",
    });
    expect(provider.asked).toEqual([]);
  });

  test("names the candidate and its description in the question, so the batch needs no shortlist", () => {
    expect(skillQuestion(candidates[0] as SkillCandidate)).toBe(
      "この依頼は「ui-capture」スキルの手順を必要とするか。（ui-capture: screenshots of a web UI）",
    );
  });
});
