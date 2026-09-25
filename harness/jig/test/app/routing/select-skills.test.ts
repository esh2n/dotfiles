import { describe, expect, test } from "bun:test";
import {
  SKILL_CHOICE_NONE,
  SKILL_CHOICE_NONE_DESCRIPTION,
  SKILL_CHOICE_QUESTION,
  selectSkills,
  skillQuestion,
  skillQuestionMode,
} from "../../../src/app/routing/select-skills";
import type { ChoiceQuery, Decided, DecisionProvider } from "../../../src/domain/decision/provider";
import type { SkillCandidate } from "../../../src/domain/skills/candidate";

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
    // Yes, but under the gate: a fallback, and the confidence says how close it came.
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBeCloseTo(0.79);
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

  test("calls a batch that says no to everything an answer, not a fallback", async () => {
    const result = await selectSkills("今日の天気", candidates, providerFor(new Map()));

    // "Nothing applies" is the judgment answering. Counting it as a fallback would make a
    // router that declined look like one that could not decide.
    expect(result.picks).toEqual([]);
    expect(result.source).toBe("decided");
    expect(result.confidence).toBeUndefined();
  });

  test("asks nothing when there is nothing to ask about", async () => {
    const provider = providerFor(new Map());
    expect(await selectSkills("何かの依頼", [], provider)).toEqual({
      picks: [],
      passed: 0,
      confidence: undefined,
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

/**
 * A provider that answers the one choice question from a distribution, and refuses every
 * other method — the point of the mode is that it spends ONE judgment, so a fake that
 * would also answer a batch could not tell a regression from a pass.
 */
class ChoiceProvider implements DecisionProvider {
  readonly name = "choice-table";
  readonly asked: ChoiceQuery<string>[] = [];

  constructor(
    private readonly value: string,
    private readonly probabilities: Readonly<Record<string, number>> | undefined,
    private readonly confidence = 1,
  ) {}

  async choice<T extends string>(query: ChoiceQuery<T>): Promise<Decided<T>> {
    this.asked.push(query as ChoiceQuery<string>);
    return {
      value: this.value as T,
      confidence: this.confidence,
      ...(this.probabilities === undefined ? {} : { probabilities: this.probabilities }),
    };
  }

  async bool(): Promise<Decided<boolean>> {
    throw new Error("choice mode must ask one choice, not a single boolean");
  }

  async boolBatch(): Promise<readonly Decided<boolean>[]> {
    throw new Error("choice mode must ask one choice, not a batch");
  }

  async score(): Promise<Decided<number>> {
    throw new Error("choice mode must ask one choice, not a score");
  }
}

const CHOICE = { question: "choice" } as const;

describe("skillQuestionMode", () => {
  test("bool unless the variable says choice, so a typo cannot change the question", () => {
    expect(skillQuestionMode({})).toBe("bool");
    expect(skillQuestionMode({ JIG_SKILL_ROUTER_QUESTION: "bool" })).toBe("bool");
    expect(skillQuestionMode({ JIG_SKILL_ROUTER_QUESTION: "choise" })).toBe("bool");
    expect(skillQuestionMode({ JIG_SKILL_ROUTER_QUESTION: " Choice " })).toBe("choice");
  });
});

describe("selectSkills in choice mode", () => {
  test("the wording is the frozen choice-en cell, literally", () => {
    // Pinned as literals, not as a reference to the constant: the point is that editing
    // the constant is caught. PROTOCOL.md §3b is frozen (FROZEN.md, 2026-09-23), so a
    // live arm asking a reworded question would not be the variant that was measured —
    // jev-bench puts the swing from wording alone at 8-16 points.
    expect(SKILL_CHOICE_QUESTION).toBe(
      'Which skill\'s instructions should be read before doing this request? Choose "none" if none of them applies.',
    );
    expect(SKILL_CHOICE_NONE_DESCRIPTION).toBe(
      "a request that needs none of these skills' procedures",
    );
    expect(SKILL_CHOICE_NONE).toBe("none");
  });

  test("asks ONE question carrying the frozen wording, every candidate and an explicit none", async () => {
    const provider = new ChoiceProvider(SKILL_CHOICE_NONE, { [SKILL_CHOICE_NONE]: 0.9 });

    await selectSkills("何かの依頼", candidates, provider, {}, CHOICE);

    expect(provider.asked).toHaveLength(1);
    const query = provider.asked[0] as ChoiceQuery<string>;
    expect(query.prompt).toBe(`Request: 何かの依頼\n\n${SKILL_CHOICE_QUESTION}`);
    expect(query.options).toEqual(["ui-capture", "writeup", "golang-patterns", "none"]);
    expect(query.criteria?.["ui-capture"]).toBe("screenshots of a web UI");
    expect(query.criteria?.none).toBe(SKILL_CHOICE_NONE_DESCRIPTION);
  });

  test("ranks the options by their probability and gates each one, so one question yields top-3", async () => {
    const provider = new ChoiceProvider("writeup", {
      "ui-capture": 0.1,
      writeup: 0.55,
      "golang-patterns": 0.3,
      none: 0.05,
    });

    const result = await selectSkills(
      "この設計をまとめて",
      candidates,
      provider,
      {},
      {
        ...CHOICE,
        threshold: 0.25,
      },
    );

    // The distribution, not the single winner, is what produced two picks.
    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["writeup", "golang-patterns"]);
    expect(result.passed).toBe(2);
    expect(result.confidence).toBeCloseTo(0.55);
    expect(result.source).toBe("decided");
  });

  test("the cap is a display limit here too: passed counts what cleared the gate before it", async () => {
    const provider = new ChoiceProvider("ui-capture", {
      "ui-capture": 0.4,
      writeup: 0.3,
      "golang-patterns": 0.29,
      none: 0.01,
    });

    const result = await selectSkills(
      "何かの依頼",
      candidates,
      provider,
      {},
      {
        ...CHOICE,
        threshold: 0.2,
        max: 2,
      },
    );

    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["ui-capture", "writeup"]);
    expect(result.passed).toBe(3);
  });

  test("none is the judgment deciding, and injects nothing even when a skill trails it", async () => {
    const provider = new ChoiceProvider(SKILL_CHOICE_NONE, {
      "ui-capture": 0.15,
      writeup: 0.1,
      "golang-patterns": 0.05,
      none: 0.7,
    });

    const result = await selectSkills("今日の天気", candidates, provider, {}, CHOICE);

    expect(result.picks).toEqual([]);
    // Same rule as the bool path: "nothing applies" decided, and the absent confidence is
    // what says so — a router that declined must not read as one that could not decide.
    expect(result.source).toBe("decided");
    expect(result.confidence).toBeUndefined();
  });

  test("a winner that did not clear the gate is a fallback, and the confidence says how close", async () => {
    const provider = new ChoiceProvider("writeup", {
      "ui-capture": 0.1,
      writeup: 0.62,
      "golang-patterns": 0.08,
      none: 0.2,
    });

    const result = await selectSkills("何かの依頼", candidates, provider, {}, CHOICE);

    expect(result.picks).toEqual([]);
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBeCloseTo(0.62);
    expect(result.passed).toBe(0);
  });

  test("a reply with no distribution degrades to its top-1 rather than inventing a ranking", async () => {
    // A judgment service older than the `probabilities` field sends value + confidence
    // only. Top-3 is not obtainable from that, and is not simulated.
    const provider = new ChoiceProvider("writeup", undefined, 0.91);

    const result = await selectSkills("この設計をまとめて", candidates, provider, {}, CHOICE);

    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["writeup"]);
    expect(result.picks.map((pick) => pick.confidence)).toEqual([0.91]);
    expect(result.passed).toBe(1);
    expect(result.source).toBe("decided");
  });

  test("a blank description is sent as the skill's own name, not as a blank criterion", async () => {
    const blank: readonly SkillCandidate[] = [
      { name: "mystery", description: "   ", path: "/skills/mystery" },
    ];
    const provider = new ChoiceProvider(SKILL_CHOICE_NONE, { mystery: 0.1, none: 0.9 });

    await selectSkills("何かの依頼", blank, provider, {}, CHOICE);

    // A blank criterion is accepted by the wire and silently degrades the judgment; the
    // jev adapter rejects it outright, which would take the whole router down with it.
    expect((provider.asked[0] as ChoiceQuery<string>).criteria?.mystery).toBe("mystery");
  });

  test("a skill named `none` is left out rather than made indistinguishable from abstaining", async () => {
    const clashing: readonly SkillCandidate[] = [
      { name: "none", description: "a skill that happens to be called none", path: "/skills/none" },
      { name: "writeup", description: "documents that are kept", path: "/skills/writeup" },
    ];
    const provider = new ChoiceProvider("writeup", { writeup: 0.9, none: 0.1 });

    const result = await selectSkills("何かの依頼", clashing, provider, {}, CHOICE);

    const query = provider.asked[0] as ChoiceQuery<string>;
    expect(query.options).toEqual(["writeup", "none"]);
    expect(query.criteria?.none).toBe(SKILL_CHOICE_NONE_DESCRIPTION);
    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["writeup"]);
  });

  test("asks nothing when there is nothing to ask about", async () => {
    const provider = new ChoiceProvider("writeup", { writeup: 1 });
    expect(await selectSkills("何かの依頼", [], provider, {}, CHOICE)).toEqual({
      picks: [],
      passed: 0,
      confidence: undefined,
      source: "fallback",
    });
    expect(provider.asked).toEqual([]);
  });

  test("the default is still the batch: a provider that refuses a choice is never asked one", async () => {
    // Guards the flip itself. The owner's default must stay `bool` until they change it,
    // so a caller that passes no `question` must take the path it always took.
    const result = await selectSkills(
      "この設計をレビューして",
      candidates,
      providerFor(answers([["writeup", true, 0.85]])),
    );

    expect(result.picks.map((pick) => pick.candidate.name)).toEqual(["writeup"]);
  });
});
