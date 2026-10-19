import { describe, expect, test } from "bun:test";
import type { OmpContext } from "../../../adapters/omp/src/omp";
import {
  activeSelector,
  createTierRouter,
  initialMode,
  routeTo,
} from "../../../adapters/omp/src/tier";

/** An omp context whose model registry holds the three proxy tiers and records every switch. */
function ctxWith(
  current: string,
  registry: readonly string[] = ["proxy/main", "proxy/complex", "proxy/executor"],
) {
  const switches: string[] = [];
  const notices: string[] = [];
  const statuses: string[] = [];
  let active = current;
  // Split on the FIRST slash only: an LM Studio id like `qwen/qwen3.6-35b-a3b` keeps its own slash.
  const split = (spec: string) => {
    const slash = spec.indexOf("/");
    return { provider: spec.slice(0, slash), id: spec.slice(slash + 1) };
  };
  const ctx: OmpContext = {
    cwd: "/work",
    hasUI: true,
    ui: {
      notify: (message) => {
        notices.push(message);
      },
      setStatus: (key, message) => {
        statuses.push(`${key}=${message}`);
      },
    },
    models: {
      current: () => split(active),
      resolve: (spec) => (registry.includes(spec) ? split(spec) : undefined),
    },
    setModel: async (spec) => {
      switches.push(String(spec));
      active = String(spec);
    },
  };
  return { ctx, switches, notices, statuses, active: () => active };
}

describe("initialMode (the session's tier at launch)", () => {
  test("main unless OMP_TIER names another tier; off stops enforcing", () => {
    expect(initialMode({})).toEqual({ kind: "held", tier: "main" });
    expect(initialMode({ OMP_TIER: "" })).toEqual({ kind: "held", tier: "main" });
    expect(initialMode({ OMP_TIER: "complex" })).toEqual({ kind: "held", tier: "complex" });
    expect(initialMode({ OMP_TIER: "executor" })).toEqual({ kind: "held", tier: "executor" });
    expect(initialMode({ OMP_TIER: "off" })).toEqual({ kind: "off" });
  });
  test("an unknown word holds main with an error naming it and the valid ones, never a silent main", () => {
    for (const word of ["auto", "deterministic", "Main"]) {
      const result = initialMode({ OMP_TIER: word });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") continue;
      expect(result.tier).toBe("main");
      expect(result.message).toBe(
        `unknown OMP_TIER "${word}"; holding main until /tier <tier> or /tier off (valid: main, complex, executor, off)`,
      );
    }
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
    expect(activeSelector(ctxWith("proxy/executor").ctx)).toBe("proxy/executor");
    expect(activeSelector({ cwd: "/", hasUI: false })).toBeUndefined();
  });
});

describe("the session tier is held, never judged", () => {
  test("a session that opens on a direct provider is moved to proxy/main", async () => {
    const router = createTierRouter({ env: {} });
    const { ctx, switches, notices } = ctxWith("lm-studio/qwen/qwen3.6-35b-a3b");
    await router.onSessionStart(ctx);
    expect(switches).toEqual(["proxy/main"]);
    expect(notices.at(-1)).toMatch(
      /lm-studio\/qwen\/qwen3.6-35b-a3b → proxy\/main \(session start/,
    );
  });
  test("a session already on its tier is left alone, silently", async () => {
    const router = createTierRouter({ env: {} });
    const { ctx, switches, notices } = ctxWith("proxy/main");
    await router.onSessionStart(ctx);
    await router.onPrompt({ prompt: "design the auth flow" }, ctx);
    await router.onPrompt({ prompt: "sort this list" }, ctx);
    expect(switches).toEqual([]);
    expect(notices).toEqual([]);
  });
  test("a /model pick of a direct provider is put back before the next prompt", async () => {
    const router = createTierRouter({ env: {} });
    const state = ctxWith("proxy/main");
    await state.ctx.setModel?.("openai-codex/gpt-5.5");
    await router.onPrompt({ prompt: "hello" }, state.ctx);
    expect(state.active()).toBe("proxy/main");
  });
  test("slash commands are not a reason to touch the model", async () => {
    const router = createTierRouter({ env: {} });
    const { ctx, switches } = ctxWith("lm-studio/qwen");
    await router.onPrompt({ prompt: "/help" }, ctx);
    expect(switches).toEqual([]);
  });
  test("/tier <tier> changes the session's tier and holds it from then on", async () => {
    const router = createTierRouter({ env: {} });
    const state = ctxWith("proxy/main");
    await router.onCommand("complex", state.ctx);
    expect(router.mode()).toBe("complex");
    expect(state.active()).toBe("proxy/complex");
    await state.ctx.setModel?.("proxy/main");
    await router.onPrompt({ prompt: "x" }, state.ctx);
    expect(state.active()).toBe("proxy/complex");
  });
  test("/tier off stops enforcing; /tier with an unknown word is refused", async () => {
    const router = createTierRouter({ env: {} });
    const state = ctxWith("proxy/main");
    await router.onCommand("off", state.ctx);
    await state.ctx.setModel?.("lm-studio/qwen");
    await router.onPrompt({ prompt: "x" }, state.ctx);
    expect(state.active()).toBe("lm-studio/qwen");

    await router.onCommand("auto", state.ctx);
    expect(state.notices.at(-1)).toMatch(/unknown tier "auto"/);
    expect(router.mode()).toBe("off");
  });
  test("an unknown OMP_TIER holds main and reports the bad value until /tier settles it", async () => {
    const router = createTierRouter({ env: { OMP_TIER: "deterministic" } });
    const state = ctxWith("lm-studio/qwen");
    await router.onSessionStart(state.ctx);
    expect(state.switches).toEqual(["proxy/main"]);
    expect(router.mode()).toBe("main");
    expect(state.statuses.at(-1)).toBe("jig-tier=tier: main");
    const errors = () =>
      state.notices.filter((n) => n.includes('unknown OMP_TIER "deterministic"'));
    expect(errors()).toHaveLength(1);
    expect(errors()[0]).toMatch(/holding main until \/tier <tier> or \/tier off/);
    await router.onPrompt({ prompt: "x" }, state.ctx);
    expect(state.switches).toEqual(["proxy/main"]);
    expect(errors()).toHaveLength(2);

    await router.onCommand("", state.ctx);
    expect(state.notices.at(-1)).toMatch(/^tier-router: unknown OMP_TIER "deterministic"/);

    await router.onCommand("executor", state.ctx);
    expect(router.mode()).toBe("executor");
    expect(state.active()).toBe("proxy/executor");
    const before = state.notices.length;
    await router.onPrompt({ prompt: "y" }, state.ctx);
    expect(state.notices).toHaveLength(before);
  });
  test("/tier off also settles an unknown OMP_TIER", async () => {
    const router = createTierRouter({ env: { OMP_TIER: "auto" } });
    const state = ctxWith("lm-studio/qwen");
    await router.onCommand("off", state.ctx);
    const before = state.notices.length;
    await router.onPrompt({ prompt: "x" }, state.ctx);
    expect(state.notices).toHaveLength(before);
    expect(state.switches).toEqual([]);
    await router.onCommand("", state.ctx);
    expect(state.notices.at(-1)).toMatch(/^tier-router: session tier off/);
  });
  test("a tier omp cannot resolve is reported and the turn goes on", async () => {
    const router = createTierRouter({ env: {} });
    const { ctx, notices, statuses } = ctxWith("lm-studio/qwen", []);
    await router.onSessionStart(ctx);
    expect(notices.at(-1)).toMatch(/no model proxy\/main in omp's registry/);
    expect(statuses.at(-1)).toBe("jig-tier=tier: not on a tier");
  });
});
