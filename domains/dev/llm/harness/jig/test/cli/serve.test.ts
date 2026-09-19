import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RunningDecisionService,
  buildJudgmentProvider,
  respondToDecision,
  serveDecisionService,
} from "../../src/cli/serve";
import { StaticProvider } from "../../src/infra/decision/static-provider";
import { ensureDecisionToken } from "../../src/infra/decision/token-file";
import { TypesafeError } from "../../src/infra/decision/typesafe-client";
import { METRICS_CONTENT_TYPE, MetricsRegistry } from "../../src/infra/metrics/registry";

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

/** A fresh temp token file path and the env override that points `serveDecisionService` at it. */
function tempTokenEnv(): { readonly env: Record<string, string>; readonly path: string } {
  const dir = mkdtempSync(join(tmpdir(), "jig-decision-token-"));
  return {
    env: { JIG_DECISION_TOKEN_FILE: join(dir, "decision.token") },
    path: join(dir, "decision.token"),
  };
}

/** Start a service with a known token (pre-written, so the service reuses it) for tests to send. */
async function startAuthedService(
  provider: StaticProvider,
  options: { readonly metrics?: MetricsRegistry } = {},
): Promise<{ readonly service: RunningDecisionService; readonly token: string }> {
  const { env, path } = tempTokenEnv();
  const token = await ensureDecisionToken(path);
  const service = serveDecisionService(
    { provider, port: 0, ...(options.metrics === undefined ? {} : { metrics: options.metrics }) },
    env,
  );
  return { service, token };
}

function authed(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

describe("serveDecisionService", () => {
  test("answers over the loopback and reports its health", async () => {
    const provider = new StaticProvider({ bool: { value: true, confidence: 0.9 } });
    const { service, token } = await startAuthedService(provider);

    try {
      const health = await fetch(`${service.url}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, provider: "static" });

      const decided = await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ op: "bool", query: { prompt: "is it?" } }),
      });
      expect(decided.status).toBe(200);
      expect(await decided.json()).toEqual({ op: "bool", value: true, confidence: 0.9 });
    } finally {
      service.stop();
    }
  });

  test("a body that is not JSON is a bad-request, not a crash", async () => {
    const { service, token } = await startAuthedService(new StaticProvider({}));

    try {
      const response = await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: authed(token),
        body: "not json at all",
      });

      expect(response.status).toBe(400);
    } finally {
      service.stop();
    }
  });

  test("/tier answers with the tier jig's own question decided", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.8 } });
    const { service, token } = await startAuthedService(provider);

    try {
      const response = await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: authed(token),
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
    const { service, token } = await startAuthedService(new StaticProvider({}));

    try {
      const response = await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: authed(token),
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
    const { service, token } = await startAuthedService(provider);

    try {
      const response = await fetch(`${service.url}/compact`, {
        method: "POST",
        headers: authed(token),
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
    const { service, token } = await startAuthedService(new StaticProvider({}));

    try {
      const response = await fetch(`${service.url}/compact`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ items: [] }),
      });

      expect(response.status).toBe(400);
    } finally {
      service.stop();
    }
  });

  test("/compact reports an unmade judgment as an upstream failure", async () => {
    const { service, token } = await startAuthedService(new StaticProvider({}));

    try {
      const response = await fetch(`${service.url}/compact`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({
          items: ["a", "b", "c", "d", "e"].map((id) => ({ id, summary: `item ${id}` })),
        }),
      });

      expect(response.status).toBe(502);
    } finally {
      service.stop();
    }
  });

  test("/metrics announces the text format and counts what was served", async () => {
    const metrics = new MetricsRegistry();
    const { service, token } = await startAuthedService(
      new StaticProvider({ bool: { value: true, confidence: 0.9 } }),
      { metrics },
    );

    try {
      await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ op: "bool", query: { prompt: "is this allowed?" }, context: {} }),
      });
      await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ op: "nonsense" }),
      });

      const response = await fetch(`${service.url}/metrics`);
      expect(response.status).toBe(200);
      // Prometheus 3.0 refuses a scrape whose Content-Type is missing or unparsable.
      expect(response.headers.get("content-type")).toBe(METRICS_CONTENT_TYPE);

      const text = await response.text();
      expect(text).toContain('jig_judgment_requests_total{kind="decide",outcome="ok"} 1');
      expect(text).toContain('jig_judgment_requests_total{kind="decide",outcome="bad_request"} 1');
      expect(text).toContain("# TYPE jig_judgment_seconds histogram");
      expect(text).toContain('jig_judgment_seconds_count{kind="decide"} 2');
      expect(text.endsWith("\n")).toBe(true);
    } finally {
      service.stop();
    }
  });

  test("the token counter is shared with the registry the service renders", async () => {
    const metrics = new MetricsRegistry();
    const { service } = await startAuthedService(new StaticProvider({}), { metrics });

    try {
      // This is what the provider's usage hook does in `jig serve`.
      metrics.countTokens("jev-1.13.0", "input", 407);

      const text = await (await fetch(`${service.url}/metrics`)).text();
      expect(text).toContain('jig_judgment_tokens_total{direction="input",model="jev-1.13.0"} 407');
    } finally {
      service.stop();
    }
  });

  test("anything but POST /decide is not found", async () => {
    const { service, token } = await startAuthedService(new StaticProvider({}));

    try {
      expect((await fetch(`${service.url}/decide`)).status).toBe(404);
      expect(
        (await fetch(`${service.url}/other`, { method: "POST", headers: authed(token) })).status,
      ).toBe(404);
    } finally {
      service.stop();
    }
  });
});

describe("serveDecisionService authentication", () => {
  test("/decide, /tier and /compact each reject a request with no bearer token", async () => {
    const { service } = await startAuthedService(new StaticProvider({}));

    try {
      for (const path of ["/decide", "/tier", "/compact"]) {
        const response = await fetch(`${service.url}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          op: "error",
          error: { kind: "unauthorized", message: expect.any(String) },
        });
      }
    } finally {
      service.stop();
    }
  });

  test("the correct bearer token is accepted", async () => {
    const provider = new StaticProvider({ bool: { value: true, confidence: 0.5 } });
    const { service, token } = await startAuthedService(provider);

    try {
      const response = await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ op: "bool", query: { prompt: "?" } }),
      });
      expect(response.status).toBe(200);
    } finally {
      service.stop();
    }
  });

  test("the wrong bearer token is rejected", async () => {
    const { service, token } = await startAuthedService(new StaticProvider({}));

    try {
      const response = await fetch(`${service.url}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer wrong-${token}` },
        body: "{}",
      });
      expect(response.status).toBe(401);
    } finally {
      service.stop();
    }
  });

  test("/health stays open with no token", async () => {
    const { service } = await startAuthedService(new StaticProvider({}));

    try {
      const response = await fetch(`${service.url}/health`);
      expect(response.status).toBe(200);
    } finally {
      service.stop();
    }
  });

  test("the token file is created with mode 0600 and reused across a second server start", async () => {
    const { env, path } = tempTokenEnv();
    const first = serveDecisionService({ provider: new StaticProvider({}), port: 0 }, env);

    // Any request to a guarded route forces the service to have awaited the
    // token (and so finished writing the file) before it answers.
    await fetch(`${first.url}/decide`, { method: "POST", body: "{}" });

    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);
    const token = (await Bun.file(path).text()).trim();
    first.stop();

    const second = serveDecisionService({ provider: new StaticProvider({}), port: 0 }, env);
    try {
      const response = await fetch(`${second.url}/decide`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ op: "bool", query: { prompt: "?" } }),
      });
      // Not 401: the second start reused the token the first one wrote.
      expect(response.status).toBe(502);
    } finally {
      second.stop();
    }
  });
});
