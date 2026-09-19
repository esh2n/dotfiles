import { describe, expect, test } from "bun:test";
import { answerDecision } from "../../../src/app/decision/answer-decision";
import type {
  BoolBatchQuery,
  BoolQuery,
  ChoiceQuery,
  DecisionContext,
  DecisionProvider,
  ScoreQuery,
} from "../../../src/domain/decision/provider";
import type { Clock, Logger } from "../../../src/domain/ports";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

interface Logged {
  readonly level: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
}

function fakeLogger(logs: Logged[]): Logger {
  const record = (level: string) => (message: string, meta?: Record<string, unknown>) => {
    logs.push({ level, message, meta });
  };
  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

/** A clock that hands out the given times in order, repeating the last one. */
function fakeClock(times: readonly number[]): Clock {
  let index = 0;
  return {
    now: () => new Date(times[Math.min(index++, times.length - 1)] ?? 0),
  };
}

/** Records every call and refuses to answer, to prove which calls reached the provider. */
function spyProvider(): { readonly calls: string[]; readonly provider: DecisionProvider } {
  const calls: string[] = [];
  const refuse = (name: string) => {
    calls.push(name);
    throw new Error(`provider was asked for ${name}`);
  };
  const provider: DecisionProvider = {
    name: "spy",
    choice: <T extends string>(_q: ChoiceQuery<T>, _c: DecisionContext) => refuse("choice"),
    bool: (_q: BoolQuery, _c: DecisionContext) => refuse("bool"),
    boolBatch: (_q: BoolBatchQuery, _c: DecisionContext) => refuse("boolBatch"),
    score: (_q: ScoreQuery, _c: DecisionContext) => refuse("score"),
  };
  return { calls, provider };
}

describe("answerDecision", () => {
  test("answers a choice with the provider's value", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.8 } });

    const result = await answerDecision(
      { op: "choice", query: { prompt: "which tier?", options: ["main", "complex"] } },
      provider,
    );

    expect(result).toEqual({
      ok: true,
      response: { op: "choice", value: "complex", confidence: 0.8 },
    });
  });

  test("a batch with no questions is answered without calling the provider", async () => {
    const { calls, provider } = spyProvider();

    const result = await answerDecision(
      { op: "boolBatch", query: { material: "m", prompts: [] } },
      provider,
    );

    expect(result).toEqual({ ok: true, response: { op: "boolBatch", values: [] } });
    expect(calls).toEqual([]);
  });

  test("a malformed request is a bad-request, not a provider failure", async () => {
    const { calls, provider } = spyProvider();

    const result = await answerDecision({ op: "predict", query: {} }, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("bad-request");
    expect(calls).toEqual([]);
  });

  test("a provider failure is a provider-error", async () => {
    const result = await answerDecision(
      { op: "bool", query: { prompt: "?" } },
      new StaticProvider({}),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("provider-error");
      expect(result.message).toMatch(/no bool answer/);
    }
  });

  test("logs the op and the duration measured by the clock", async () => {
    const logs: Logged[] = [];
    const provider = new StaticProvider({ bool: { value: true, confidence: 0.9 } });

    await answerDecision({ op: "bool", query: { prompt: "?" } }, provider, {
      logger: fakeLogger(logs),
      clock: fakeClock([1_000, 1_234]),
    });

    expect(logs).toHaveLength(1);
    const entry = logs[0];
    expect(entry?.level).toBe("debug");
    expect(entry?.message).toBe("decision.answer");
    expect(entry?.meta).toEqual({ op: "bool", durationMs: 234, source: "static" });
  });

  test("a failure is logged at warn with the reason", async () => {
    const logs: Logged[] = [];

    await answerDecision({ op: "score", query: { prompt: "?" } }, new StaticProvider({}), {
      logger: fakeLogger(logs),
    });

    expect(logs[0]?.level).toBe("warn");
    expect(logs[0]?.message).toBe("decision.failed");
    expect(String(logs[0]?.meta?.reason)).toMatch(/no score answer/);
  });
});
