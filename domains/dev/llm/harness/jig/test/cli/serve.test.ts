import { describe, expect, test } from "bun:test";
import {
  buildJudgmentProvider,
  respondToDecision,
  serveDecisionService,
} from "../../src/cli/serve";
import { StaticProvider } from "../../src/infra/decision/static-provider";
import { TypesafeError } from "../../src/infra/decision/typesafe-client";

describe("respondToDecision", () => {
  test("a judgment is 200 with the judgment as the body", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.8 } });

    const response = await respondToDecision(
      { op: "choice", query: { prompt: "which?", options: ["main", "complex"] } },
      provider,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ op: "choice", value: "complex", confidence: 0.8 });
  });

  test("a malformed request is 400 and says so in the body", async () => {
    const response = await respondToDecision({ op: "nope", query: {} }, new StaticProvider({}));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      op: "error",
      error: { kind: "bad-request", message: expect.stringContaining("is not one of") },
    });
  });

  test("a judgment that could not be made is 502, distinguished in the body", async () => {
    const response = await respondToDecision(
      { op: "bool", query: { prompt: "?" } },
      new StaticProvider({}),
    );

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      op: "error",
      error: { kind: "provider-error", message: expect.stringContaining("no bool answer") },
    });
  });
});

describe("buildJudgmentProvider", () => {
  test("names the missing key and the way to provide it", () => {
    expect(() => buildJudgmentProvider({})).toThrow(TypesafeError);
    expect(() => buildJudgmentProvider({})).toThrow(/op run --env-file/);
  });

  test("builds the credentialed provider when the key is present", () => {
    expect(buildJudgmentProvider({ TYPESAFE_API_KEY: "sk-test" }).name).toBe("jev");
  });
});

describe("serveDecisionService", () => {
  test("answers over the loopback and reports its health", async () => {
    const provider = new StaticProvider({ bool: { value: true, confidence: 0.9 } });
    const service = serveDecisionService({ provider, port: 0 });

    try {
      const health = await fetch(`${service.url}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, provider: "static" });

      const decided = await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "bool", query: { prompt: "is it?" } }),
      });
      expect(decided.status).toBe(200);
      expect(await decided.json()).toEqual({ op: "bool", value: true, confidence: 0.9 });
    } finally {
      service.stop();
    }
  });

  test("a body that is not JSON is a bad-request, not a crash", async () => {
    const service = serveDecisionService({ provider: new StaticProvider({}), port: 0 });

    try {
      const response = await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json at all",
      });

      expect(response.status).toBe(400);
    } finally {
      service.stop();
    }
  });

  test("/tier answers with the tier jig's own question decided", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.8 } });
    const service = serveDecisionService({ provider, port: 0 });

    try {
      const response = await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: "design a new subsystem" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        tier: "complex",
        confidence: 0.8,
        source: "decided",
      });
    } finally {
      service.stop();
    }
  });

  test("/tier with an empty request is a bad-request", async () => {
    const service = serveDecisionService({ provider: new StaticProvider({}), port: 0 });

    try {
      const response = await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: "" }),
      });

      expect(response.status).toBe(400);
    } finally {
      service.stop();
    }
  });

  test("/compact answers keep-or-drop for the items it is given", async () => {
    const provider = new StaticProvider({
      bools: [
        { value: false, confidence: 0.85 },
        { value: true, confidence: 0.9 },
      ],
    });
    const service = serveDecisionService({ provider, port: 0 });

    try {
      const response = await fetch(`${service.url}/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: ["a", "b", "c", "d", "e"].map((id) => ({ id, summary: `item ${id}` })),
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { kept: { id: string }[] };
      expect(body.kept.map((item) => item.id)).toEqual(["a", "c", "d", "e"]);
    } finally {
      service.stop();
    }
  });

  test("/compact with nothing to judge is a bad-request", async () => {
    const service = serveDecisionService({ provider: new StaticProvider({}), port: 0 });

    try {
      const response = await fetch(`${service.url}/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });

      expect(response.status).toBe(400);
    } finally {
      service.stop();
    }
  });

  test("/compact reports an unmade judgment as an upstream failure", async () => {
    const service = serveDecisionService({ provider: new StaticProvider({}), port: 0 });

    try {
      const response = await fetch(`${service.url}/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: ["a", "b", "c", "d", "e"].map((id) => ({ id, summary: `item ${id}` })),
        }),
      });

      expect(response.status).toBe(502);
    } finally {
      service.stop();
    }
  });

  test("anything but POST /decide is not found", async () => {
    const service = serveDecisionService({ provider: new StaticProvider({}), port: 0 });

    try {
      expect((await fetch(`${service.url}/decide`)).status).toBe(404);
      expect((await fetch(`${service.url}/other`, { method: "POST" })).status).toBe(404);
    } finally {
      service.stop();
    }
  });
});
