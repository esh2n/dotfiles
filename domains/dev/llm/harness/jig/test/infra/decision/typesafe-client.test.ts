import { describe, expect, test } from "bun:test";
import type { SystemOneRequest } from "../../../src/infra/decision/jev-provider";
import {
  type FetchLike,
  TypesafeError,
  createTypesafeClient,
  typesafeKeyFromEnv,
} from "../../../src/infra/decision/typesafe-client";

const REQUEST: SystemOneRequest = {
  state: "the item list",
  questions: { q: { type: "noul", instructions: "keep a?" } },
};

const ANSWER = { model: "jev-1", usage: { input_tokens: 12, output_tokens: 3 }, answers: {} };

interface Attempt {
  readonly url: string;
  readonly init?: RequestInit;
}

/** A fetch that replies with the given (status, body) pairs in order, repeating the last. */
function scriptedFetch(replies: readonly { status: number; body: string }[]): {
  readonly attempts: Attempt[];
  readonly fetch: FetchLike;
} {
  const attempts: Attempt[] = [];
  return {
    attempts,
    fetch: async (url: string, init?: RequestInit) => {
      attempts.push({ url, init });
      const reply = replies[Math.min(attempts.length - 1, replies.length - 1)];
      return new Response(reply?.body ?? "", { status: reply?.status ?? 200 });
    },
  };
}

function clientWith(fetch: FetchLike, backoffs: number[] = []) {
  return createTypesafeClient({
    apiKey: "sk-test",
    fetch,
    sleep: async (ms) => {
      backoffs.push(ms);
    },
    random: () => 0,
  });
}

describe("typesafeKeyFromEnv", () => {
  test("fails with the instruction that fixes it, not a bare 401", () => {
    expect(() => typesafeKeyFromEnv({})).toThrow(/TYPESAFE_API_KEY is not set/);
    expect(() => typesafeKeyFromEnv({ TYPESAFE_API_KEY: "   " })).toThrow(/op run --env-file/);
  });

  test("returns the key when it is set", () => {
    expect(typesafeKeyFromEnv({ TYPESAFE_API_KEY: "sk-test" })).toBe("sk-test");
  });
});

describe("createTypesafeClient", () => {
  test("posts the request to /v1/systemone with the key as a bearer token", async () => {
    const { attempts, fetch } = scriptedFetch([{ status: 200, body: JSON.stringify(ANSWER) }]);

    await clientWith(fetch)(REQUEST);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(attempts[0]?.init?.method).toBe("POST");
    const headers = attempts[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(attempts[0]?.init?.body))).toEqual(REQUEST);
  });

  test("returns the parsed result", async () => {
    const { fetch } = scriptedFetch([{ status: 200, body: JSON.stringify(ANSWER) }]);

    expect(await clientWith(fetch)(REQUEST)).toEqual(ANSWER);
  });

  test("tolerates a reply without usage or model instead of failing a valid judgment", async () => {
    const { fetch } = scriptedFetch([{ status: 200, body: JSON.stringify({ answers: {} }) }]);

    expect(await clientWith(fetch)(REQUEST)).toEqual({
      model: "",
      usage: { input_tokens: 0, output_tokens: 0 },
      answers: {},
    });
  });

  test("retries 429 with exponential backoff and jitter, then succeeds", async () => {
    const backoffs: number[] = [];
    const { attempts, fetch } = scriptedFetch([
      { status: 429, body: "slow down" },
      { status: 200, body: JSON.stringify(ANSWER) },
    ]);

    const result = await clientWith(fetch, backoffs)(REQUEST);

    expect(result).toEqual(ANSWER);
    expect(attempts).toHaveLength(2);
    expect(backoffs).toEqual([1_000]);
  });

  test("an authentication failure is not retried — it is our bug, not a transient one", async () => {
    const backoffs: number[] = [];
    const { attempts, fetch } = scriptedFetch([{ status: 401, body: "invalid key" }]);

    await expect(clientWith(fetch, backoffs)(REQUEST)).rejects.toThrow(/HTTP 401: invalid key/);
    expect(attempts).toHaveLength(1);
    expect(backoffs).toEqual([]);
  });

  test("gives up after retries + 1 attempts and says how many were made", async () => {
    const backoffs: number[] = [];
    const { attempts, fetch } = scriptedFetch([{ status: 503, body: "unavailable" }]);

    await expect(clientWith(fetch, backoffs)(REQUEST)).rejects.toThrow(
      /failed after 3 attempts \(HTTP 503: unavailable\)/,
    );
    expect(attempts).toHaveLength(3);
    expect(backoffs).toEqual([1_000, 2_000]);
  });

  test("backoff is capped at 8s however many attempts were made", async () => {
    const backoffs: number[] = [];
    const { fetch } = scriptedFetch([{ status: 500, body: "boom" }]);
    const client = createTypesafeClient({
      apiKey: "sk-test",
      fetch,
      retries: 6,
      sleep: async (ms) => {
        backoffs.push(ms);
      },
      random: () => 0,
    });

    await expect(client(REQUEST)).rejects.toThrow(TypesafeError);
    expect(backoffs).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  });

  test("a reply that is not JSON is retried, then reported", async () => {
    const { attempts, fetch } = scriptedFetch([{ status: 200, body: "<html>proxy</html>" }]);

    await expect(clientWith(fetch)(REQUEST)).rejects.toThrow(
      /failed after 3 attempts \(reply was not JSON\)/,
    );
    expect(attempts).toHaveLength(3);
  });

  test("a reply without answers is a failure, never an empty judgment", async () => {
    const { fetch } = scriptedFetch([{ status: 200, body: JSON.stringify({ model: "jev-1" }) }]);

    await expect(clientWith(fetch)(REQUEST)).rejects.toThrow(/without an answers object/);
  });
});
