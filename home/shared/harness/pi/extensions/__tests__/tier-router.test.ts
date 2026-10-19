import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import tierRouter, { initialMode, isTier } from "../tier-router";

describe("isTier", () => {
  test("accepts the three LiteLLM tiers and nothing else", () => {
    expect(isTier("main")).toBe(true);
    expect(isTier("complex")).toBe(true);
    expect(isTier("executor")).toBe(true);
    expect(isTier("auto")).toBe(false);
    expect(isTier("")).toBe(false);
    expect(isTier(undefined)).toBe(false);
  });
});

describe("initialMode (the session's tier at launch)", () => {
  test("main unless PI_TIER names another tier", () => {
    expect(initialMode({})).toEqual({ kind: "held", tier: "main" });
    expect(initialMode({ PI_TIER: "" })).toEqual({ kind: "held", tier: "main" });
    expect(initialMode({ PI_TIER: "complex" })).toEqual({ kind: "held", tier: "complex" });
    expect(initialMode({ PI_TIER: "executor" })).toEqual({ kind: "held", tier: "executor" });
  });
  test("off stops enforcing", () => {
    expect(initialMode({ PI_TIER: "off" })).toEqual({ kind: "off" });
  });
  test("an unknown value holds main with an error naming it, never a silent main", () => {
    for (const bad of ["deterministic", "auto", "turbo"]) {
      const launch = initialMode({ PI_TIER: bad });
      expect(launch.kind).toBe("error");
      if (launch.kind !== "error") continue;
      expect(launch.tier).toBe("main");
      expect(launch.message).toBe(
        `unknown PI_TIER "${bad}"; holding main until /tier <tier> or /tier off (valid: main, complex, executor, off)`,
      );
    }
  });
});

type Model = { readonly provider: string; readonly id: string };
type Notice = { readonly message: string; readonly level: string };
type Handler = (event: unknown, ctx: unknown) => Promise<void>;
type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

/**
 * Load the extension into a fake ExtensionAPI that records its `on(...)` and
 * `registerCommand(...)` handlers, with a context whose registry holds the
 * three proxy tiers and whose active model starts at `current`.
 */
function load(env: string | undefined, current: Model = { provider: "lm-studio", id: "qwen" }) {
  if (env === undefined) delete process.env.PI_TIER;
  else process.env.PI_TIER = env;
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, CommandHandler>();
  const switches: string[] = [];
  const notices: Notice[] = [];
  const ctx = {
    model: current as Model | undefined,
    modelRegistry: {
      find: (provider: string, id: string): Model | undefined =>
        provider === "proxy" && isTier(id) ? { provider, id } : undefined,
    },
    ui: {
      notify: (message: string, level: string) => {
        notices.push({ message, level });
      },
      setStatus: () => {},
    },
  };
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    registerCommand: (name: string, options: { handler: CommandHandler }) => {
      commands.set(name, options.handler);
    },
    setModel: async (model: Model) => {
      switches.push(`${model.provider}/${model.id}`);
      ctx.model = model;
      return true;
    },
  };
  tierRouter(pi as unknown as ExtensionAPI);
  const run = async (event: string) => {
    const handler = handlers.get(event);
    if (handler === undefined) throw new Error(`no ${event} handler`);
    await handler({}, ctx);
  };
  const tier = async (args: string) => {
    const handler = commands.get("tier");
    if (handler === undefined) throw new Error("no /tier command");
    await handler(args, ctx);
  };
  const errors = () => notices.filter((n) => n.level === "error");
  return { run, tier, switches, notices, errors };
}

describe("the extension holds main under an unknown PI_TIER", () => {
  const saved = process.env.PI_TIER;
  afterEach(() => {
    if (saved === undefined) delete process.env.PI_TIER;
    else process.env.PI_TIER = saved;
  });

  test("before_agent_start routes to main and reports the bad value as an error", async () => {
    const pi = load("exec");
    await pi.run("before_agent_start");
    expect(pi.switches).toEqual(["proxy/main"]);
    expect(pi.errors()).toHaveLength(1);
    expect(pi.errors()[0]?.message).toBe(
      'tier-router: unknown PI_TIER "exec"; holding main until /tier <tier> or /tier off (valid: main, complex, executor, off)',
    );
    await pi.run("before_agent_start");
    expect(pi.switches).toEqual(["proxy/main"]);
    expect(pi.errors()).toHaveLength(2);
  });

  test("/tier shows the error", async () => {
    const pi = load("exec");
    await pi.tier("");
    expect(pi.notices.at(-1)?.level).toBe("error");
    expect(pi.notices.at(-1)?.message).toMatch(/^tier-router: unknown PI_TIER "exec"/);
  });

  test("/tier off clears the error and stops holding", async () => {
    const pi = load("exec");
    await pi.tier("off");
    await pi.run("before_agent_start");
    expect(pi.errors()).toEqual([]);
    expect(pi.switches).toEqual([]);
    await pi.tier("");
    expect(pi.notices.at(-1)?.message).toMatch(/^tier-router: session tier off/);
  });

  test("/tier executor clears the error and holds executor", async () => {
    const pi = load("exec");
    await pi.tier("executor");
    expect(pi.switches).toEqual(["proxy/executor"]);
    await pi.run("before_agent_start");
    expect(pi.errors()).toEqual([]);
    expect(pi.switches).toEqual(["proxy/executor"]);
  });

  test("an unset PI_TIER holds main with no error", async () => {
    const pi = load(undefined);
    await pi.run("before_agent_start");
    expect(pi.switches).toEqual(["proxy/main"]);
    expect(pi.errors()).toEqual([]);
  });
});
