import { describe, expect, test } from "bun:test";
import type { OmpContext } from "../../../adapters/omp/src/omp";
import {
  activeSelector,
  askTier,
  createTierRouter,
  readDecision,
  routeTo,
  serviceBase,
} from "../../../adapters/omp/src/tier";

/** An omp context whose model registry holds the three proxy tiers and records every switch. */
function ctxWith(
  current: string,
  registry: readonly string[] = ["proxy/main", "proxy/complex", "proxy/deterministic"],
) {
  const switches: string[] = [];
  const notices: string[] = [];
  const statuses: string[] = [];
  let active = current;
  const ctx: OmpContext = {
    cwd: "/work",
    hasUI: true,
    ui: {
      notify: (message) => {
        notices.push(message);
      },
      setStatus: (message) => {
        statuses.push(message);
      },
    },
    models: {
      current: () => {
        const [provider, id] = active.split("/");
        return { provider, id };
      },
      resolve: (spec) =>
        registry.includes(spec)
          ? { provider: spec.split("/")[0], id: spec.split("/")[1] }
          : undefined,
    },
    setModel: async (spec) => {
      switches.push(String(spec));
      active = String(spec);
    },
  };
  return { ctx, switches, notices, statuses, active: () => active };
}

/** A `fetch` that answers `/tier` with one fixed body. */
function tierService(body: unknown, status = 200): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.endsWith("/tier")) throw new Error(`unexpected url ${url}`);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("readDecision (the same contract pi's tier-router reads)", () => {
  test("a valid reply keeps tier, confidence and source", () => {
    expect(readDecision({ tier: "complex", confidence: 0.87, source: "decided" })).toEqual({
      tier: "complex",
      confidence: 0.87,
      source: "decided",
    });
  });
  test("missing confidence is 0 and anything but 'decided' is a fallback", () => {
    expect(readDecision({ tier: "main", source: "guessed" })).toEqual({
      tier: "main",
      confidence: 0,
      source: "fallback",
    });
  });
  test("no tier → the service's error message, or a generic one", () => {
    expect(() => readDecision({ error: { message: "no judgment available" } })).toThrow(
      "no judgment available",
    );
    expect(() => readDecision({ tier: "bogus" })).toThrow(/no tier in the reply/);
    expect(() => readDecision(null)).toThrow("tier service replied with no body");
  });
});

describe("serviceBase", () => {
  test("strips an endpoint suffix and a trailing slash", () => {
    expect(serviceBase({ JIG_DECISION_URL: "http://127.0.0.1:4100/tier" })).toBe(
      "http://127.0.0.1:4100",
    );
    expect(serviceBase({ JIG_DECISION_URL: "http://h:1/" })).toBe("http://h:1");
    expect(serviceBase({})).toBe("http://127.0.0.1:4100");
  });
});

describe("askTier", () => {
  test("posts the prompt as omp's request and reads the decision", async () => {
    let sent: unknown;
    const doFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ tier: "deterministic", confidence: 0.9, source: "decided" }),
      );
    }) as typeof fetch;
    const decision = await askTier("sort this list", 1000, {
      env: { JIG_DECISION_TOKEN_FILE: "/nonexistent" },
      fetch: doFetch,
    });
    expect(sent).toEqual({ harness: "omp", request: "sort this list" });
    expect(decision.tier).toBe("deterministic");
  });
  test("a 404 names the missing endpoint", async () => {
    await expect(
      askTier("x", 1000, {
        env: { JIG_DECISION_TOKEN_FILE: "/nonexistent" },
        fetch: tierService({}, 404),
      }),
    ).rejects.toThrow(/no \/tier endpoint/);
  });
});

describe("routeTo", () => {
  test("switches through ctx.setModel to provider/tier", async () => {
    const { ctx, switches } = ctxWith("proxy/main");
    expect(await routeTo("complex", "proxy", ctx)).toEqual({
      switched: true,
      message: "switched to proxy/complex",
    });
    expect(switches).toEqual(["proxy/complex"]);
  });
  test("does nothing when that model is already active", async () => {
    const { ctx, switches } = ctxWith("proxy/main");
    expect(await routeTo("main", "proxy", ctx)).toEqual({
      switched: false,
      message: "already main",
    });
    expect(switches).toEqual([]);
  });
  test("refuses, naming the registry, when omp does not know the model", async () => {
    const { ctx, switches } = ctxWith("anthropic/claude-fable-5", []);
    const result = await routeTo("main", "proxy", ctx);
    expect(result.switched).toBe(false);
    expect(result.message).toMatch(/no model proxy\/main in omp's registry/);
    expect(switches).toEqual([]);
  });
  test("a build without ctx.setModel is reported, not thrown", async () => {
    const ctx: OmpContext = { cwd: "/work", hasUI: false };
    expect(await routeTo("main", "proxy", ctx)).toEqual({
      switched: false,
      message: "this omp build exposes no ctx.setModel",
    });
  });
  test("activeSelector reads provider/id from ctx.models.current()", () => {
    expect(activeSelector(ctxWith("proxy/deterministic").ctx)).toBe("proxy/deterministic");
    expect(activeSelector({ cwd: "/", hasUI: false })).toBeUndefined();
  });
});

describe("the router on a prompt", () => {
  test("auto: judges the prompt and switches to the tier that came back", async () => {
    const router = createTierRouter({
      env: { JIG_DECISION_TOKEN_FILE: "/nonexistent" },
      fetch: tierService({ tier: "complex", confidence: 0.81, source: "decided" }),
    });
    const { ctx, switches, statuses } = ctxWith("proxy/main");
    await router.onPrompt({ prompt: "design the auth flow" }, ctx);
    expect(switches).toEqual(["proxy/complex"]);
    expect(statuses.at(-1)).toBe("tier: complex (0.81)");
  });
  test("slash commands and empty prompts are not judged", async () => {
    let calls = 0;
    const router = createTierRouter({
      env: { JIG_DECISION_TOKEN_FILE: "/nonexistent" },
      fetch: (async (_input: string | URL | Request) => {
        calls += 1;
        return new Response(JSON.stringify({ tier: "main" }));
      }) as typeof fetch,
    });
    const { ctx } = ctxWith("proxy/main");
    await router.onPrompt({ prompt: "/help" }, ctx);
    await router.onPrompt({ prompt: "   " }, ctx);
    expect(calls).toBe(0);
  });
  test("an unreachable service keeps the current model and says so once", async () => {
    const router = createTierRouter({
      env: { JIG_DECISION_TOKEN_FILE: "/nonexistent" },
      fetch: (async (_input: string | URL | Request): Promise<Response> => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    const { ctx, switches, notices, statuses } = ctxWith("proxy/main");
    await router.onPrompt({ prompt: "hello" }, ctx);
    await router.onPrompt({ prompt: "hello again" }, ctx);
    expect(switches).toEqual([]);
    expect(notices.filter((n) => n.includes("unavailable"))).toHaveLength(1);
    expect(statuses.at(-1)).toBe("tier: judgment unavailable");
  });
  test("OMP_TIER_ROUTER=off starts off; /tier auto turns it on; a forced tier stops judging", async () => {
    let calls = 0;
    const router = createTierRouter({
      env: { OMP_TIER_ROUTER: "off", JIG_DECISION_TOKEN_FILE: "/nonexistent" },
      fetch: (async (_input: string | URL | Request) => {
        calls += 1;
        return new Response(
          JSON.stringify({ tier: "complex", confidence: 0.9, source: "decided" }),
        );
      }) as typeof fetch,
    });
    const { ctx, switches } = ctxWith("proxy/main");
    expect(router.mode()).toBe("off");
    await router.onPrompt({ prompt: "x" }, ctx);
    expect(calls).toBe(0);

    await router.onCommand("auto", ctx);
    await router.onPrompt({ prompt: "x" }, ctx);
    expect(calls).toBe(1);
    expect(switches).toEqual(["proxy/complex"]);

    await router.onCommand("deterministic", ctx);
    expect(router.mode()).toBe("deterministic");
    await router.onPrompt({ prompt: "y" }, ctx);
    expect(calls).toBe(1);
    expect(switches.at(-1)).toBe("proxy/deterministic");
  });
  test("/tier with an unknown word is refused with the choices", async () => {
    const router = createTierRouter({ env: { JIG_DECISION_TOKEN_FILE: "/nonexistent" } });
    const { ctx, notices } = ctxWith("proxy/main");
    await router.onCommand("turbo", ctx);
    expect(notices.at(-1)).toMatch(/unknown mode "turbo"/);
    expect(router.mode()).toBe("auto");
  });
});
