import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OmpContext, OmpExtensionApi } from "../../../adapters/omp/src/omp";
import {
  DESCRIPTION,
  PARAMETERS,
  SPEND_TAG_ENV,
  registerSwarm,
} from "../../../adapters/omp/src/swarm";
import { SWARM_TOOL_DESCRIPTION, SWARM_TOOL_PARAMETERS } from "../../../src/app/swarm/tool";
import { SPEND_TAG_ENV as CORE_SPEND_TAG_ENV, WORKER_ENV } from "../../../src/infra/swarm/session";

type Tool = Parameters<NonNullable<OmpExtensionApi["registerTool"]>>[0];

function fakeOmp() {
  const tools: Tool[] = [];
  const events: string[] = [];
  const api = {
    on: (event: string) => events.push(event),
    registerTool: (tool: Tool) => tools.push(tool),
    sendMessage: () => {},
  } as unknown as OmpExtensionApi;
  return { api, tools, events };
}

describe("omp's swarm registration", () => {
  test("the copies omp needs at load time match jig's originals", () => {
    expect(DESCRIPTION).toBe(SWARM_TOOL_DESCRIPTION);
    expect(PARAMETERS).toEqual(SWARM_TOOL_PARAMETERS);
  });

  test("pi's description is the same text", () => {
    const pi = readFileSync(
      join(import.meta.dir, "../../../../../home/shared/harness/pi/extensions/swarm.ts"),
      "utf8",
    );
    const list = pi.slice(pi.indexOf("description: ["), pi.indexOf('].join(" ")'));
    const sentences = [...list.matchAll(/^\s*("(?:[^"\\]|\\.)*"),$/gm)].map(
      (m) => JSON.parse(m[1] ?? '""') as string,
    );
    expect(sentences.join(" ")).toBe(SWARM_TOOL_DESCRIPTION);
  });

  test("the worker marker is the same name on both sides", () => {
    expect(WORKER_ENV).toBe("JIG_SWARM_WORKER");
    expect(SPEND_TAG_ENV).toBe(CORE_SPEND_TAG_ENV);
  });

  test("registers an essential swarm tool and a shutdown handler", () => {
    const { api, tools, events } = fakeOmp();
    registerSwarm(api, {});
    expect(tools.map((t) => [t.name, t.loadMode])).toEqual([["swarm", "essential"]]);
    expect(events).toEqual(["session_shutdown"]);
  });

  test("inside a worker nothing is registered", () => {
    const { api, tools, events } = fakeOmp();
    registerSwarm(api, { JIG_SWARM_WORKER: "1" });
    expect(tools).toEqual([]);
    expect(events).toEqual([]);
  });

  test("a tagged worker adds its tag to proxy requests only", async () => {
    const handlers = new Map<string, (event: unknown, ctx: OmpContext) => Promise<unknown>>();
    const api = {
      on: (event: string, handler: (event: unknown, ctx: OmpContext) => Promise<unknown>) =>
        handlers.set(event, handler),
    } as unknown as OmpExtensionApi;
    registerSwarm(api, { JIG_SWARM_WORKER: "1", JIG_SWARM_TAG: "jig-swarm:s:a" });
    const hook = handlers.get("before_provider_request");
    const body = { model: "main", messages: [] };
    const onProxy: OmpContext = {
      cwd: "/",
      hasUI: false,
      model: { id: "main", provider: "proxy" },
    };
    expect(await hook?.({ payload: body }, onProxy)).toEqual({
      ...body,
      metadata: { tags: ["jig-swarm:s:a"] },
    });
    const elsewhere: OmpContext = { ...onProxy, model: { id: "x", provider: "anthropic" } };
    expect(await hook?.({ payload: body }, elsewhere)).toBeUndefined();
  });

  test("wait reaches the shared swarm with omp's abort signal", async () => {
    const { api, tools } = fakeOmp();
    registerSwarm(api, { XDG_STATE_HOME: join(import.meta.dir, ".no-state") });
    const ctx: OmpContext = { cwd: process.cwd(), hasUI: false };
    const aborted = new AbortController();
    aborted.abort();
    const result = await tools[0]?.execute(
      "c1",
      { action: "wait" },
      aborted.signal,
      undefined,
      ctx,
    );
    expect(result?.content[0]?.text).toContain("Wait cancelled");
  });

  test("a call reaches the shared swarm through the runtime import", async () => {
    const { api, tools } = fakeOmp();
    registerSwarm(api, { XDG_STATE_HOME: join(import.meta.dir, ".no-state") });
    const ctx: OmpContext = { cwd: process.cwd(), hasUI: false };
    const result = await tools[0]?.execute("c1", { action: "status" }, undefined, undefined, ctx);
    expect(result?.content[0]?.text).toBe("No workers in this session.");
    expect(result?.isError).toBe(false);
  });
});
