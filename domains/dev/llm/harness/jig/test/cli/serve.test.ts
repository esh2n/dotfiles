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
import type {
  BoolBatchQuery,
  BoolQuery,
  ChoiceQuery,
  Decided,
  DecisionContext,
  DecisionProvider,
  ScoreQuery,
} from "../../src/domain/decision/provider";
import type { TierLogEntry } from "../../src/domain/routing/tier-log";
import type { SkillCandidate } from "../../src/domain/skills/candidate";
import type { RouterLogEntry } from "../../src/domain/skills/router-log";
import { StaticProvider } from "../../src/infra/decision/static-provider";
import { ensureDecisionToken } from "../../src/infra/decision/token-file";
import { TypesafeError } from "../../src/infra/decision/typesafe-client";
import { currentJudgmentKind } from "../../src/infra/metrics/judgment-kind";
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

  test("builds the provider in PROXY mode from the proxy key alone", () => {
    expect(
      buildJudgmentProvider({
        JIG_JEV_BASE_URL: "http://localhost:4000/typesafe",
        JIG_JEV_API_KEY: "sk-litellm-master",
      }).name,
    ).toBe("jev");
  });
});

/**
 * Records which request's kind was in scope when the provider was called: twice per
 * call, before and after an awaited suspension, because a kind that survives the
 * call but not the `await` would be attributed to the wrong endpoint in production.
 * The method that was called is recorded too — the three endpoints share one
 * provider instance, so the method is what ties an observation to its request.
 */
class KindRecordingProvider implements DecisionProvider {
  readonly name = "kind-recorder";
  readonly observations: { readonly method: string; readonly kind: string | undefined }[] = [];

  private async note(method: string): Promise<void> {
    this.observations.push({ method, kind: currentJudgmentKind() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.observations.push({ method, kind: currentJudgmentKind() });
  }

  async choice<T extends string>(
    query: ChoiceQuery<T>,
    _context: DecisionContext,
  ): Promise<Decided<T>> {
    await this.note("choice");
    const first = query.options[0];
    if (first === undefined) throw new Error("no options");
    return { value: first, confidence: 1 };
  }

  async bool(_query: BoolQuery, _context: DecisionContext): Promise<Decided<boolean>> {
    await this.note("bool");
    return { value: true, confidence: 1 };
  }

  async boolBatch(
    query: BoolBatchQuery,
    _context: DecisionContext,
  ): Promise<readonly Decided<boolean>[]> {
    await this.note("boolBatch");
    return query.prompts.map(() => ({ value: false, confidence: 1 }));
  }

  async score(_query: ScoreQuery, _context: DecisionContext): Promise<Decided<number>> {
    await this.note("score");
    return { value: 0, confidence: 1 };
  }
}

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
  provider: DecisionProvider,
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
        chosen: "complex",
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
    // b is reproducible (dropped), c is not (kept); a, d and e are pinned.
    const provider = new StaticProvider({
      bools: [
        { value: true, confidence: 0.85 },
        { value: false, confidence: 0.9 },
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
      // This is what the provider's usage hook does in `jig serve`, kind included.
      metrics.countTokens("jev-1.13.0", "input", 407, "tier");

      const text = await (await fetch(`${service.url}/metrics`)).text();
      expect(text).toContain(
        'jig_judgment_tokens_total{direction="input",kind="tier",model="jev-1.13.0"} 407',
      );
    } finally {
      service.stop();
    }
  });

  test("a tier judgment is counted by the tier it chose", async () => {
    const metrics = new MetricsRegistry();
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.9 } });
    const { service, token } = await startAuthedService(provider, { metrics });

    try {
      const response = await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ request: "refactor the parser" }),
      });
      expect(response.status).toBe(200);

      const text = await (await fetch(`${service.url}/metrics`)).text();
      expect(text).toContain('jig_tier_decisions_total{source="decided",tier="complex"} 1');
    } finally {
      service.stop();
    }
  });

  test("a weak tier judgment is counted as a fallback, not as the tier it named", async () => {
    const metrics = new MetricsRegistry();
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.2 } });
    const { service, token } = await startAuthedService(provider, { metrics });

    try {
      await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ request: "refactor the parser" }),
      });

      const text = await (await fetch(`${service.url}/metrics`)).text();
      expect(text).toContain('jig_tier_decisions_total{source="fallback",tier="main"} 1');
      expect(text).not.toContain('source="decided",tier="complex"');
    } finally {
      service.stop();
    }
  });

  test("a compaction judgment is counted by kept and dropped, pinned items included", async () => {
    const metrics = new MetricsRegistry();
    const provider = new StaticProvider({
      bools: [
        { value: true, confidence: 0.9 },
        { value: false, confidence: 0.9 },
      ],
    });
    const { service, token } = await startAuthedService(provider, { metrics });

    try {
      // a is pinned (first), d and e are pinned (most recent two); b is judged
      // reproducible (dropped) and c is not (kept).
      await fetch(`${service.url}/compact`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({
          items: ["a", "b", "c", "d", "e"].map((id) => ({ id, summary: `item ${id}` })),
        }),
      });

      const text = await (await fetch(`${service.url}/metrics`)).text();
      expect(text).toContain('jig_compaction_items_total{decision="dropped"} 1');
      expect(text).toContain('jig_compaction_items_total{decision="kept"} 4');
    } finally {
      service.stop();
    }
  });

  test("each request judges in its own kind scope, even when three overlap", async () => {
    const provider = new KindRecordingProvider();
    const { service, token } = await startAuthedService(provider);

    try {
      const answers = await Promise.all([
        fetch(`${service.url}/tier`, {
          method: "POST",
          headers: authed(token),
          body: JSON.stringify({ request: "route me" }),
        }),
        fetch(`${service.url}/compact`, {
          method: "POST",
          headers: authed(token),
          // Five items so one is actually judged: with two, both are pinned and
          // no question is asked, which would prove nothing about the scope.
          body: JSON.stringify({
            items: ["a", "b", "c", "d", "e"].map((id) => ({ id, summary: `item ${id}` })),
          }),
        }),
        fetch(`${service.url}/decide`, {
          method: "POST",
          headers: authed(token),
          body: JSON.stringify({ op: "bool", query: { prompt: "?" } }),
        }),
      ]);
      expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);

      // Six observations, interleaved in whatever order the three requests reach
      // the provider: each method must see its own request's kind, both before and
      // after its await — a shared or leaked scope shows up as the wrong kind here.
      expect(provider.observations.length).toBe(6);
      const kindsFor = (method: string) =>
        provider.observations.filter((o) => o.method === method).map((o) => o.kind);
      expect(kindsFor("choice")).toEqual(["tier", "tier"]);
      expect(kindsFor("boolBatch")).toEqual(["compact", "compact"]);
      expect(kindsFor("bool")).toEqual(["decide", "decide"]);
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

describe("the /skill path's router log", () => {
  /** A service whose skill catalog is one skill, so the judgment has something to pick. */
  async function startSkillService(
    provider: DecisionProvider,
    entries: RouterLogEntry[],
    options: { readonly skillCatalog?: () => Promise<readonly SkillCandidate[]> } = {},
  ): Promise<{ readonly service: RunningDecisionService; readonly token: string }> {
    const { env, path } = tempTokenEnv();
    const token = await ensureDecisionToken(path);
    const service = serveDecisionService(
      {
        provider,
        port: 0,
        skillCatalog:
          options.skillCatalog ??
          (async () => [
            {
              name: "writeup",
              description: "documents that are kept",
              path: "/skills/writeup/SKILL.md",
            },
          ]),
        recordSkill: async (entry) => {
          entries.push(entry);
        },
      },
      env,
    );
    return { service, token };
  }

  test("records the judgment with the harness that asked for it", async () => {
    const entries: RouterLogEntry[] = [];
    const { service, token } = await startSkillService(
      new StaticProvider({ bool: { value: true, confidence: 0.9 } }),
      entries,
    );

    try {
      const response = await fetch(`${service.url}/skill`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ harness: "pi", prompt: "決定記録をまとめて" }),
      });

      expect(response.status).toBe(200);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.harness).toBe("pi");
      expect(entries[0]?.skills).toEqual(["writeup"]);
      expect(entries[0]?.source).toBe("decided");
      expect(entries[0]?.promptHash).toMatch(/^[0-9a-f]{12}$/);
      expect(entries[0]?.promptChars).toBe("決定記録をまとめて".length);
    } finally {
      service.stop();
    }
  });

  test("records an unlabelled request as unknown rather than as some harness", async () => {
    const entries: RouterLogEntry[] = [];
    const { service, token } = await startSkillService(
      new StaticProvider({ bool: { value: false, confidence: 0.9 } }),
      entries,
    );

    try {
      await fetch(`${service.url}/skill`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ prompt: "今日の天気を教えて" }),
      });

      expect(entries[0]?.harness).toBe("unknown");
      expect(entries[0]?.skills).toEqual([]);
    } finally {
      service.stop();
    }
  });

  test("records a judgment that failed, which no other record holds", async () => {
    const entries: RouterLogEntry[] = [];
    // The endpoint answers 502 when the judgment cannot be made; the log must still say
    // the router was consulted, because "could not answer" and "never asked" are
    // different facts about a request the model then handled alone.
    const { service, token } = await startSkillService(new StaticProvider({}), entries, {
      skillCatalog: async () => {
        throw new Error("model refused");
      },
    });

    try {
      const response = await fetch(`${service.url}/skill`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ harness: "pi", prompt: "決定記録をまとめて" }),
      });

      expect(response.status).toBe(502);
      expect(entries[0]?.harness).toBe("pi");
      expect(String(entries[0]?.error)).toContain("refused");
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

describe("the /tier path's decision log", () => {
  async function startTierService(
    provider: DecisionProvider,
    entries: TierLogEntry[],
  ): Promise<{ readonly service: RunningDecisionService; readonly token: string }> {
    const { env, path } = tempTokenEnv();
    const token = await ensureDecisionToken(path);
    const service = serveDecisionService(
      {
        provider,
        port: 0,
        recordTier: async (entry) => {
          entries.push(entry);
        },
      },
      env,
    );
    return { service, token };
  }

  test("records what the judgment preferred, what was returned, and for which request", async () => {
    const entries: TierLogEntry[] = [];
    const { service, token } = await startTierService(
      new StaticProvider({ choice: { value: "deterministic", confidence: 0.55 } }),
      entries,
    );
    try {
      const response = await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ harness: "pi", request: "rename foo to bar in\nevery file" }),
      });
      expect(response.status).toBe(200);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        harness: "pi",
        promptPreview: "rename foo to bar in",
        promptChars: "rename foo to bar in\nevery file".length,
        tier: "main",
        chosen: "deterministic",
        confidence: 0.55,
        source: "fallback",
      });
      expect(entries[0]?.promptHash).toMatch(/^[0-9a-f]{12}$/);
    } finally {
      service.stop();
    }
  });

  test("a failed judgment is written down with its error", async () => {
    const entries: TierLogEntry[] = [];
    const { service, token } = await startTierService(
      new StaticProvider({ choice: { value: "main", confidence: 0.9 } }),
      entries,
    );
    try {
      await fetch(`${service.url}/tier`, {
        method: "POST",
        headers: authed(token),
        body: JSON.stringify({ request: "" }),
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.harness).toBe("unknown");
      expect(entries[0]?.error).toContain("empty");
      expect(entries[0]?.tier).toBeUndefined();
    } finally {
      service.stop();
    }
  });
});
