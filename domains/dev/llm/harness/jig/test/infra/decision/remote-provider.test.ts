import { describe, expect, test } from "bun:test";
import {
  RemoteDecisionProtocolError,
  type RemoteDecisionRequest,
} from "../../../src/domain/decision/remote";
import {
  type RemoteDecisionClient,
  RemoteDecisionError,
  RemoteDecisionProvider,
} from "../../../src/infra/decision/remote-provider";

function clientReturning(reply: unknown): {
  readonly requests: RemoteDecisionRequest[];
  readonly client: RemoteDecisionClient;
} {
  const requests: RemoteDecisionRequest[] = [];
  return {
    requests,
    client: async (request: RemoteDecisionRequest) => {
      requests.push(request);
      return reply;
    },
  };
}

describe("RemoteDecisionProvider", () => {
  test("sends the port's query and returns the service's judgment", async () => {
    const { requests, client } = clientReturning({
      op: "choice",
      value: "complex",
      confidence: 0.8,
    });
    const provider = new RemoteDecisionProvider({ client });

    const decided = await provider.choice(
      { prompt: "which tier?", options: ["main", "complex"] },
      { session: "abc" },
    );

    expect(decided).toEqual({ value: "complex", confidence: 0.8 });
    expect(requests).toEqual([
      {
        op: "choice",
        query: { prompt: "which tier?", options: ["main", "complex"] },
        context: { session: "abc" },
      },
    ]);
  });

  test("a reply about a different operation is not read as this answer", async () => {
    const { client } = clientReturning({ op: "bool", value: true, confidence: 1 });
    const provider = new RemoteDecisionProvider({ client });

    await expect(provider.choice({ prompt: "?", options: ["a", "b"] }, {})).rejects.toThrow(
      RemoteDecisionProtocolError,
    );
  });

  test("the service's own rejection becomes a RemoteDecisionError", async () => {
    const { client } = clientReturning({
      op: "error",
      error: { kind: "provider-error", message: "judgment model timed out" },
    });
    const provider = new RemoteDecisionProvider({ client });

    await expect(provider.bool({ prompt: "?" }, {})).rejects.toThrow(
      /provider-error: judgment model timed out/,
    );
  });

  test("a choice outside the options that were asked is rejected", async () => {
    const { client } = clientReturning({ op: "choice", value: "turbo", confidence: 0.9 });
    const provider = new RemoteDecisionProvider({ client });

    await expect(
      provider.choice({ prompt: "?", options: ["main", "complex"] }, {}),
    ).rejects.toThrow(/not one of \[main, complex\]/);
  });

  test("a batch answer count that does not match the prompts is rejected", async () => {
    const { client } = clientReturning({
      op: "boolBatch",
      values: [{ value: true, confidence: 0.9 }],
    });
    const provider = new RemoteDecisionProvider({ client });

    await expect(provider.boolBatch({ material: "m", prompts: ["a", "b"] }, {})).rejects.toThrow(
      /answered 1 questions, asked 2/,
    );
  });

  test("a batch with nothing to ask spends no round trip", async () => {
    const { requests, client } = clientReturning({ op: "boolBatch", values: [] });
    const provider = new RemoteDecisionProvider({ client });

    expect(await provider.boolBatch({ material: "m", prompts: [] }, {})).toEqual([]);
    expect(requests).toEqual([]);
  });

  test("a score outside the rubric that was asked is rejected", async () => {
    const { client } = clientReturning({ op: "score", value: 3, confidence: 0.7 });
    const provider = new RemoteDecisionProvider({ client });

    await expect(
      provider.score({ prompt: "?", criteria: ["low", "mid", "high"] }, {}),
    ).rejects.toThrow(/outside 0\.\.2/);
  });

  test("a non-boolean bool answer is rejected", async () => {
    const { client } = clientReturning({ op: "bool", value: "yes", confidence: 0.5 });
    const provider = new RemoteDecisionProvider({ client });

    await expect(provider.bool({ prompt: "?" }, {})).rejects.toThrow(/must be a boolean/);
  });

  test("an unparseable reply is a protocol error, never a value", async () => {
    const { client } = clientReturning(undefined);
    const provider = new RemoteDecisionProvider({ client });

    await expect(provider.bool({ prompt: "?" }, {})).rejects.toBeInstanceOf(
      RemoteDecisionProtocolError,
    );
  });
});
