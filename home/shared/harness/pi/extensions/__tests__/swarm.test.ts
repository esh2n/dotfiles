import { afterEach, describe, expect, mock, test } from "bun:test";

// pi provides `typebox` at load time (its loader aliases it); here a stand-in
// that builds the same plain JSON Schema objects is enough.
const schema =
  (type: string) =>
  (extra: Record<string, unknown> = {}) => ({ type, ...extra });
mock.module("typebox", () => ({
  Type: {
    Object: (properties: unknown, extra = {}) => ({ type: "object", properties, ...extra }),
    Array: (items: unknown, extra = {}) => ({ type: "array", items, ...extra }),
    Union: (anyOf: unknown) => ({ anyOf }),
    Literal: (constant: unknown) => ({ const: constant }),
    Optional: (inner: unknown) => inner,
    String: schema("string"),
    Boolean: schema("boolean"),
  },
}));
const { default: register } = await import("../swarm");

interface Registered {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }>;
}

function fakePi() {
  const tools: Registered[] = [];
  const events: string[] = [];
  const api = {
    registerTool: (tool: Registered) => tools.push(tool),
    on: (event: string) => events.push(event),
    sendMessage: () => {},
  };
  return { api, tools, events };
}

afterEach(() => {
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.JIG_SWARM_WORKER;
});

describe("pi's swarm extension", () => {
  test("registers the swarm tool and stops workers when the session ends", () => {
    const { api, tools, events } = fakePi();
    register(api as never);
    expect(tools.map((t) => t.name)).toEqual(["swarm"]);
    expect(events).toEqual(["session_shutdown"]);
  });

  test("a worker registers nothing, so workers never start workers", () => {
    process.env.JIG_SWARM_WORKER = "1";
    const { api, tools, events } = fakePi();
    register(api as never);
    expect(tools).toEqual([]);
    expect(events).toEqual([]);
  });

  test("status on a fresh session says there are no workers", async () => {
    const { api, tools } = fakePi();
    register(api as never);
    const ctx = {
      cwd: process.cwd(),
      hasUI: false,
      mode: "json",
      model: undefined,
      sessionManager: { getSessionId: () => "test-session" },
      ui: { setWidget: () => {} },
    };
    const result = await tools[0]?.execute(
      "call-1",
      { action: "status" },
      undefined,
      undefined,
      ctx,
    );
    expect(result?.content[0]?.text).toBe("No workers in this session.");
  });

  test("a bad action is a failed tool call (pi fails by throwing)", async () => {
    const { api, tools } = fakePi();
    register(api as never);
    const ctx = {
      cwd: process.cwd(),
      hasUI: false,
      mode: "json",
      sessionManager: { getSessionId: () => "test-session" },
      ui: { setWidget: () => {} },
    };
    await expect(
      tools[0]?.execute("call-2", { action: "explode" }, undefined, undefined, ctx),
    ).rejects.toThrow("action must be");
  });
});
