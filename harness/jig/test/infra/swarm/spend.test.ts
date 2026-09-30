import { describe, expect, test } from "bun:test";
import { loadProxyBaseUrl, spendSource } from "../../../src/infra/swarm/session";
import {
  litellmSpendLookup,
  parseSpendRows,
  proxyRoot,
  spendRequestUrl,
} from "../../../src/infra/swarm/spend";

const NOON = Date.UTC(2026, 8, 30, 12);

describe("the proxy's spend by tag", () => {
  test("is asked at the proxy's root, around today, for the given tags", () => {
    expect(proxyRoot("http://localhost:4000/v1")).toBe("http://localhost:4000");
    expect(proxyRoot("http://localhost:4000/")).toBe("http://localhost:4000");
    const url = new URL(spendRequestUrl("http://localhost:4000", ["t:a", "t:b"], NOON));
    expect(url.pathname).toBe("/global/spend/tags");
    expect(url.searchParams.get("start_date")).toBe("2026-09-29");
    expect(url.searchParams.get("end_date")).toBe("2026-10-01");
    expect(url.searchParams.get("tags")).toBe("t:a,t:b");
  });

  test("the UI's spend_per_tag becomes tag → USD, numbers as strings included, odd rows skipped", () => {
    const costs = parseSpendRows({
      spend_per_tag: [
        { name: "a", spend: 0.25, log_count: 2 },
        { name: "b", spend: "0.5", log_count: 1 },
        { name: "c", spend: null },
        "junk",
      ],
    });
    expect([...costs]).toEqual([
      ["a", 0.25],
      ["b", 0.5],
    ]);
  });

  test("any other body is an error that names what came back, not zero", () => {
    expect(() => parseSpendRows({ detail: "no db" })).toThrow("got keys detail");
    expect(() => parseSpendRows([])).toThrow("got a list");
  });

  test("sends the proxy key and reports a refusal", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const lookup = litellmSpendLookup({
      baseUrl: "http://localhost:4000/v1",
      apiKey: "k",
      now: () => NOON,
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ spend_per_tag: [{ name: "a", spend: 1 }] }));
      }) as typeof fetch,
    });
    expect([...(await lookup(["a"]))]).toEqual([["a", 1]]);
    expect(seen[0]?.auth).toBe("Bearer k");
    expect(await lookup([])).toEqual(new Map());
    expect(seen).toHaveLength(1);

    const refused = litellmSpendLookup({
      baseUrl: "http://localhost:4000/v1",
      apiKey: "k",
      now: () => NOON,
      fetch: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(refused(["a"])).rejects.toThrow("answered 401");
  });

  test("the proxy's address comes from tiers.json", () => {
    expect(loadProxyBaseUrl()).toBe("http://localhost:4000/v1");
  });

  test("costs are read only with the proxy key and the proxy's address", () => {
    const url = () => "http://localhost:4000/v1";
    expect(spendSource({}, "s", url)).toBeUndefined();
    expect(spendSource({ LITELLM_API_KEY: "" }, "s", url)).toBeUndefined();
    expect(spendSource({ LITELLM_API_KEY: "k" }, "s", () => undefined)).toBeUndefined();
    const source = spendSource({ LITELLM_API_KEY: "k" }, "session-1", url);
    expect(source?.tag("worker-a")).toBe("jig-swarm:session-1:worker-a");
  });
});
