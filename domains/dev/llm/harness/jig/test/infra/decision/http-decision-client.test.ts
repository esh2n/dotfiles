import { describe, expect, test } from "bun:test";
import {
  type FetchLike,
  createHttpDecisionClient,
} from "../../../src/infra/decision/http-decision-client";
import { RemoteDecisionError } from "../../../src/infra/decision/remote-provider";

interface Captured {
  readonly url: string;
  readonly init?: RequestInit;
}

function fakeFetch(reply: { status?: number; text: string }): {
  readonly calls: Captured[];
  readonly fetch: FetchLike;
} {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(reply.text, { status: reply.status ?? 200 });
    },
  };
}

describe("createHttpDecisionClient", () => {
  test("posts the request envelope as JSON and returns the parsed reply", async () => {
    const { calls, fetch } = fakeFetch({
      text: JSON.stringify({ op: "bool", value: true, confidence: 0.9 }),
    });
    const client = createHttpDecisionClient({ url: "http://127.0.0.1:4100/decide", fetch });

    const reply = await client({ op: "bool", query: { prompt: "?" }, context: {} });

    expect(reply).toEqual({ op: "bool", value: true, confidence: 0.9 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://127.0.0.1:4100/decide");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      op: "bool",
      query: { prompt: "?" },
      context: {},
    });
    expect(calls[0]?.init?.signal).toBeDefined();
  });

  test("passes the service's own error body through untouched", async () => {
    const { fetch } = fakeFetch({
      status: 502,
      text: JSON.stringify({
        op: "error",
        error: { kind: "provider-error", message: "upstream 503" },
      }),
    });
    const client = createHttpDecisionClient({ url: "http://127.0.0.1:4100/decide", fetch });

    expect(await client({ op: "bool", query: { prompt: "?" }, context: {} })).toEqual({
      op: "error",
      error: { kind: "provider-error", message: "upstream 503" },
    });
  });

  test("an unreachable service is a RemoteDecisionError naming the address", async () => {
    const client = createHttpDecisionClient({
      url: "http://127.0.0.1:4100/decide",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    await expect(client({ op: "bool", query: { prompt: "?" }, context: {} })).rejects.toThrow(
      /unreachable at http:\/\/127\.0\.0\.1:4100\/decide/,
    );
  });

  test("a reply that is not JSON is a RemoteDecisionError", async () => {
    const { fetch } = fakeFetch({ status: 200, text: "<html>proxy error</html>" });
    const client = createHttpDecisionClient({ url: "http://127.0.0.1:4100/decide", fetch });

    await expect(
      client({ op: "bool", query: { prompt: "?" }, context: {} }),
    ).rejects.toBeInstanceOf(RemoteDecisionError);
  });
});
