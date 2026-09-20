import { describe, expect, test } from "bun:test";
import { gate } from "../../../src/domain/decision/provider";
import {
  JevProvider,
  JevRequestError,
  JevResponseError,
  type JevUsage,
  type SystemOneAnswer,
  type SystemOneRequest,
  type SystemOneResult,
} from "../../../src/infra/decision/jev-provider";

function result(answers: SystemOneResult["answers"]): SystemOneResult {
  return { model: "jev-test", usage: { input_tokens: 1, output_tokens: 1 }, answers };
}

/** Records the exact request the adapter sends, so the wire shape is asserted, not assumed. */
class ScriptedClient {
  readonly calls: SystemOneRequest[] = [];

  constructor(private readonly outcome: SystemOneResult | Error) {}

  async ask(request: SystemOneRequest): Promise<SystemOneResult> {
    this.calls.push(request);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

function providerFor(outcome: SystemOneResult | Error): {
  provider: JevProvider;
  client: ScriptedClient;
} {
  const client = new ScriptedClient(outcome);
  return { provider: new JevProvider({ client: (request) => client.ask(request) }), client };
}

const TIERS = ["main", "complex"] as const;

describe("JevProvider.choice", () => {
  test("sends one choice question carrying the per-option criteria", async () => {
    const { provider, client } = providerFor(
      result({
        q: {
          type: "choice",
          choice: "complex",
          probabilities: { main: 0.1, complex: 0.9 },
          confidence: 0.9,
        },
      }),
    );

    const decided = await provider.choice(
      {
        prompt: "Which tier fits this request?",
        options: TIERS,
        criteria: { main: "routine", complex: "hard" },
      },
      {},
    );

    expect(decided).toEqual({ value: "complex", confidence: 0.9 });
    expect(client.calls).toEqual([
      {
        state: "Which tier fits this request?",
        questions: {
          q: {
            type: "choice",
            instructions: "Which tier fits this request?",
            criteria: { main: "routine", complex: "hard" },
          },
        },
        model: "jev-latest",
      },
    ]);
  });

  test("sends the model the API requires, and honours an explicit one", async () => {
    const answers = { q: { type: "noul" as const, noul: 0.9 } };
    const scripted = new ScriptedClient(result(answers));
    const defaulted = new JevProvider({ client: (request) => scripted.ask(request) });
    await defaulted.bool({ prompt: "keep?" }, {});

    const pinned = new ScriptedClient(result(answers));
    const pinnedProvider = new JevProvider({
      client: (request) => pinned.ask(request),
      model: "jev-1-13",
    });
    await pinnedProvider.bool({ prompt: "keep?" }, {});

    expect(scripted.calls[0]?.model).toBe("jev-latest");
    expect(pinned.calls[0]?.model).toBe("jev-1-13");
  });

  test("without criteria each option describes itself", async () => {
    const { provider, client } = providerFor(
      result({
        q: {
          type: "choice",
          choice: "main",
          probabilities: { main: 1, complex: 0 },
          confidence: 1,
        },
      }),
    );

    await provider.choice({ prompt: "Which tier?", options: TIERS }, {});

    expect(client.calls[0]?.questions.q).toEqual({
      type: "choice",
      instructions: "Which tier?",
      criteria: { main: "main", complex: "complex" },
    });
  });

  test("an option left without a description is a request error, not a model call", async () => {
    const { provider, client } = providerFor(result({}));

    await expect(
      provider.choice(
        { prompt: "Which tier?", options: TIERS, criteria: { main: "routine", complex: "" } },
        {},
      ),
    ).rejects.toThrow(JevRequestError);
    expect(client.calls).toEqual([]);
  });

  test("criteria carrying a key outside options is a request error, not a model call", async () => {
    const { provider, client } = providerFor(result({}));

    await expect(
      provider.choice(
        {
          prompt: "Which tier?",
          options: TIERS,
          // "deterministic" is not one of TIERS: a caller bug, not something
          // the model should ever be asked to pick from.
          criteria: { main: "routine", complex: "hard", deterministic: "sneaky" } as Record<
            (typeof TIERS)[number],
            string
          >,
        },
        {},
      ),
    ).rejects.toThrow(JevRequestError);
    expect(client.calls).toEqual([]);
  });

  test("rejects an answer that picks something never offered", async () => {
    const { provider } = providerFor(
      result({
        q: {
          type: "choice",
          choice: "deterministic",
          probabilities: { main: 0.5, complex: 0.5 },
          confidence: 0.5,
        },
      }),
    );

    await expect(provider.choice({ prompt: "Which tier?", options: TIERS }, {})).rejects.toThrow(
      JevResponseError,
    );
  });

  test("rejects probabilities that do not cover the options", async () => {
    const { provider } = providerFor(
      result({ q: { type: "choice", choice: "main", probabilities: { main: 1 }, confidence: 1 } }),
    );

    await expect(provider.choice({ prompt: "Which tier?", options: TIERS }, {})).rejects.toThrow(
      JevResponseError,
    );
  });
});

describe("JevProvider.bool (noul)", () => {
  test("asks a noul and maps the probability to a decision plus that side's confidence", async () => {
    const cases = [
      { noul: 0.99, value: true, confidence: 0.99 },
      { noul: 0.02, value: false, confidence: 0.98 },
      { noul: 0.55, value: true, confidence: 0.55 },
    ];

    for (const expected of cases) {
      const { provider, client } = providerFor(
        result({ q: { type: "noul", noul: expected.noul } }),
      );

      expect(await provider.bool({ prompt: "Should this item be kept verbatim?" }, {})).toEqual({
        value: expected.value,
        confidence: expected.confidence,
      });
      expect(client.calls[0]?.questions.q).toEqual({
        type: "noul",
        instructions: "Should this item be kept verbatim?",
      });
    }
  });

  test("the confidence threshold is the dead band: a mid noul falls back to the safe side", async () => {
    const { provider } = providerFor(result({ q: { type: "noul", noul: 0.55 } }));

    const decided = await provider.bool({ prompt: "Should this item be kept verbatim?" }, {});

    expect(gate(decided, 0.6, true)).toEqual({ value: true, confidence: 0.55, source: "fallback" });
    expect(gate(decided, 0.5, true)).toEqual({ value: true, confidence: 0.55, source: "decided" });
  });

  test("rejects a noul outside [0, 1]", async () => {
    const { provider } = providerFor(result({ q: { type: "noul", noul: 1.4 } }));

    await expect(provider.bool({ prompt: "keep?" }, {})).rejects.toThrow(JevResponseError);
  });
});

describe("JevProvider.score", () => {
  test("returns the rubric position with the model's confidence", async () => {
    const { provider, client } = providerFor(
      result({
        q: {
          type: "score",
          score: 1.035,
          probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 },
          confidence: 0.8,
          legend: ["calm", "frustrated", "angry"],
        },
      }),
    );

    const decided = await provider.score(
      { prompt: "How frustrated is the customer?", criteria: ["calm", "frustrated", "angry"] },
      {},
    );

    expect(decided).toEqual({ value: 1.035, confidence: 0.8 });
    expect(client.calls[0]?.questions.q).toEqual({
      type: "score",
      instructions: "How frustrated is the customer?",
      criteria: ["calm", "frustrated", "angry"],
    });
  });

  test("a rubric shorter than the API minimum is a request error, not a model call", async () => {
    const { provider, client } = providerFor(result({}));

    await expect(
      provider.score({ prompt: "How bad?", criteria: ["only one"] }, {}),
    ).rejects.toThrow(JevRequestError);
    expect(client.calls).toEqual([]);
  });

  test("rejects a score outside the rubric range", async () => {
    const { provider } = providerFor(
      result({
        q: {
          type: "score",
          score: 3,
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
          legend: ["low", "high"],
        },
      }),
    );

    await expect(
      provider.score({ prompt: "How bad?", criteria: ["low", "high"] }, {}),
    ).rejects.toThrow(JevResponseError);
  });
});

describe("JevProvider failure paths", () => {
  test("an answer of the wrong type is rejected", async () => {
    const { provider } = providerFor(result({ q: { type: "noul", noul: 0.9 } }));

    await expect(provider.choice({ prompt: "Which tier?", options: TIERS }, {})).rejects.toThrow(
      JevResponseError,
    );
  });

  test("a transport failure surfaces unchanged", async () => {
    const { provider } = providerFor(new Error("socket closed"));

    await expect(provider.bool({ prompt: "keep?" }, {})).rejects.toThrow("socket closed");
  });
});

describe("JevProvider metering", () => {
  test("reports the vendor's own token counts once per request", async () => {
    const usages: JevUsage[] = [];
    const client = new ScriptedClient(result({ q: { type: "noul", noul: 0.9 } }));
    const provider = new JevProvider({
      client: (request) => client.ask(request),
      onUsage: (usage) => usages.push(usage),
    });

    await provider.bool({ prompt: "keep?" }, {});

    expect(usages).toEqual([{ model: "jev-test", input_tokens: 1, output_tokens: 1 }]);
  });

  test("a batch reports one usage per request, not per question", async () => {
    const usages: JevUsage[] = [];
    const client = new QueuedClient([nouls(32, 0.9), nouls(1, 0.1)]);
    const provider = new JevProvider({
      client: (request) => client.ask(request),
      onUsage: (usage) => usages.push(usage),
    });

    await provider.boolBatch(
      { material: "m", prompts: Array.from({ length: 33 }, (_, index) => `question ${index}`) },
      {},
    );

    expect(usages).toHaveLength(2);
  });

  test("a failed request reports no usage — there is nothing to price", async () => {
    const usages: JevUsage[] = [];
    const provider = new JevProvider({
      client: async () => {
        throw new Error("socket closed");
      },
      onUsage: (usage) => usages.push(usage),
    });

    await expect(provider.bool({ prompt: "keep?" }, {})).rejects.toThrow("socket closed");
    expect(usages).toEqual([]);
  });
});

/** One queued result per request, so a chunked call can be asserted call by call. */
class QueuedClient {
  readonly calls: SystemOneRequest[] = [];

  constructor(private readonly outcomes: readonly SystemOneResult[]) {}

  async ask(request: SystemOneRequest): Promise<SystemOneResult> {
    this.calls.push(request);
    const outcome = this.outcomes[this.calls.length - 1];
    if (outcome === undefined)
      throw new Error(`no queued outcome for request ${this.calls.length}`);
    return outcome;
  }
}

/** A result with `count` noul answers, all at the same probability. */
function nouls(count: number, value: number): SystemOneResult {
  const answers: Record<string, SystemOneAnswer> = {};
  for (let index = 0; index < count; index++) answers[`q${index}`] = { type: "noul", noul: value };
  return result(answers);
}

describe("JevProvider.boolBatch", () => {
  test("asks every question against ONE material in a single request", async () => {
    const { provider, client } = providerFor(
      result({ q0: { type: "noul", noul: 0.9 }, q1: { type: "noul", noul: 0.1 } }),
    );

    const decided = await provider.boolBatch(
      {
        material: "- [a] first\n- [b] second",
        prompts: ['Keep item "a" verbatim?', 'Keep item "b" verbatim?'],
      },
      {},
    );

    expect(decided).toEqual([
      { value: true, confidence: 0.9 },
      { value: false, confidence: 0.9 },
    ]);
    expect(client.calls).toEqual([
      {
        state: "- [a] first\n- [b] second",
        questions: {
          q0: { type: "noul", instructions: 'Keep item "a" verbatim?' },
          q1: { type: "noul", instructions: 'Keep item "b" verbatim?' },
        },
        model: "jev-latest",
      },
    ]);
  });

  test("chunks past the 32-question wire limit and keeps order across the boundary", async () => {
    const client = new QueuedClient([nouls(32, 0.9), nouls(1, 0.1)]);
    const provider = new JevProvider({ client: (request) => client.ask(request) });
    const prompts = Array.from({ length: 33 }, (_, index) => `question ${index}`);

    const decided = await provider.boolBatch({ material: "the material", prompts }, {});

    expect(client.calls.length).toBe(2);
    expect(Object.keys(client.calls[0]?.questions ?? {}).length).toBe(32);
    expect(client.calls[1]?.questions).toEqual({
      q0: { type: "noul", instructions: "question 32" },
    });
    expect(decided.length).toBe(33);
    expect(decided[31]).toEqual({ value: true, confidence: 0.9 });
    expect(decided[32]).toEqual({ value: false, confidence: 0.9 });
    // The material is sent once per request, never once per question.
    expect(client.calls.every((call) => call.state === "the material")).toBe(true);
  });

  test("nothing to ask means no request at all", async () => {
    const { provider, client } = providerFor(result({}));

    expect(await provider.boolBatch({ material: "m", prompts: [] }, {})).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  test("one malformed answer in the batch is rejected", async () => {
    const { provider } = providerFor(
      result({ q0: { type: "noul", noul: 0.9 }, q1: { type: "noul", noul: 1.5 } }),
    );

    await expect(provider.boolBatch({ material: "m", prompts: ["a", "b"] }, {})).rejects.toThrow(
      JevResponseError,
    );
  });

  test("chunks are dispatched in parallel, not one at a time", async () => {
    // Three chunks (65 prompts = 32 + 32 + 1), each taking DELAY_MS to
    // "answer". Sequential dispatch takes >= 3 * DELAY_MS; parallel dispatch
    // takes roughly one DELAY_MS regardless of chunk count. The margin is
    // generous (2x one delay) so this is not flaky under load, while still
    // being far below the 3x a sequential loop would need.
    const DELAY_MS = 60;
    let inFlight = 0;
    let maxInFlight = 0;

    const client = async (request: SystemOneRequest): Promise<SystemOneResult> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      inFlight--;
      const answers: Record<string, SystemOneAnswer> = {};
      for (const id of Object.keys(request.questions)) answers[id] = { type: "noul", noul: 0.9 };
      return result(answers);
    };
    const provider = new JevProvider({ client });
    const prompts = Array.from({ length: 65 }, (_, index) => `question ${index}`);

    const started = performance.now();
    const decided = await provider.boolBatch({ material: "m", prompts }, {});
    const elapsedMs = performance.now() - started;

    expect(decided.length).toBe(65);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(elapsedMs).toBeLessThan(DELAY_MS * 2);
  });

  test("chunks dispatched in parallel still keep prompt order in the result", async () => {
    // Chunk 0 (the slower one) resolves AFTER chunk 1 — order in the
    // returned array must still follow `prompts`, not resolution order.
    const client = new QueuedClient([]);
    const delays = [30, 5];
    let call = 0;
    const provider = new JevProvider({
      client: async (request) => {
        const index = call++;
        client.calls.push(request);
        await new Promise((resolve) => setTimeout(resolve, delays[index]));
        const answers: Record<string, SystemOneAnswer> = {};
        for (const id of Object.keys(request.questions)) {
          answers[id] = { type: "noul", noul: index === 0 ? 0.9 : 0.1 };
        }
        return result(answers);
      },
    });
    const prompts = Array.from({ length: 33 }, (_, index) => `question ${index}`);

    const decided = await provider.boolBatch({ material: "m", prompts }, {});

    expect(client.calls.length).toBe(2);
    expect(decided[0]).toEqual({ value: true, confidence: 0.9 }); // from chunk 0
    expect(decided[32]).toEqual({ value: false, confidence: 0.9 }); // from chunk 1
  });
});
