import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FetchLike,
  createHttpDecisionClient,
} from "../../../src/infra/decision/http-decision-client";
import { RemoteDecisionError } from "../../../src/infra/decision/remote-provider";

/** A temp token file holding `content` (or no file at all, when omitted). */
function tempTokenFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jig-decision-client-token-"));
  const path = join(dir, "decision.token");
  if (content !== undefined) writeFileSync(path, content, { mode: 0o600 });
  return path;
}

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

  test("attaches the token file's contents as a bearer header", async () => {
    const tokenFilePath = tempTokenFile("sekret-token");
    const { calls, fetch } = fakeFetch({
      text: JSON.stringify({ op: "bool", value: true, confidence: 0.5 }),
    });
    const client = createHttpDecisionClient({
      url: "http://127.0.0.1:4100/decide",
      fetch,
      tokenFilePath,
    });

    await client({ op: "bool", query: { prompt: "?" }, context: {} });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sekret-token");
  });

  test("re-reads the token file on every call", async () => {
    const tokenFilePath = tempTokenFile("first-token");
    const { calls, fetch } = fakeFetch({
      text: JSON.stringify({ op: "bool", value: true, confidence: 0.5 }),
    });
    const client = createHttpDecisionClient({
      url: "http://127.0.0.1:4100/decide",
      fetch,
      tokenFilePath,
    });

    await client({ op: "bool", query: { prompt: "?" }, context: {} });
    writeFileSync(tokenFilePath, "second-token", { mode: 0o600 });
    await client({ op: "bool", query: { prompt: "?" }, context: {} });

    const headers = calls.map(
      (call) => (call.init?.headers as Record<string, string>).authorization,
    );
    expect(headers).toEqual(["Bearer first-token", "Bearer second-token"]);
  });

  test("sends no authorization header when the token file is missing, and warns once", async () => {
    const tokenFilePath = tempTokenFile(); // no file written
    const { calls, fetch } = fakeFetch({
      text: JSON.stringify({ op: "bool", value: true, confidence: 0.5 }),
    });
    const warnings: unknown[][] = [];
    const client = createHttpDecisionClient({
      url: "http://127.0.0.1:4100/decide",
      fetch,
      tokenFilePath,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    });

    await client({ op: "bool", query: { prompt: "?" }, context: {} });
    await client({ op: "bool", query: { prompt: "?" }, context: {} });

    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>).authorization).toBeUndefined();
    }
    expect(warnings).toHaveLength(1);
  });
});
