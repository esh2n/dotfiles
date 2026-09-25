import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import register from "../../../adapters/omp/src/index";
import type {
  OmpContext,
  OmpExtensionApi,
  OmpSessionStopEvent,
  OmpSessionStopResult,
  OmpToolCallEvent,
  OmpToolCallResult,
  OmpToolResultEvent,
} from "../../../adapters/omp/src/omp";

/**
 * The extension as omp loads it: the default export, subscribing four
 * handlers, reaching jig's core through the runtime import in `jig.ts`. This
 * is the only test that exercises that import, which is the part a symlinked
 * install depends on.
 */

const POLICY = {
  version: 1,
  floor: [],
  rules: [
    {
      id: "forbid-rm-rf",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "rm", argv: "(^|\\s)-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)\\b" },
      why: "recursive force delete",
      profiles: ["minimal", "standard", "strict"],
    },
  ],
};

interface Handlers {
  sessionStart?: (event: unknown, ctx: OmpContext) => Promise<void> | void;
  toolCall?: (
    event: OmpToolCallEvent,
    ctx: OmpContext,
  ) => Promise<OmpToolCallResult | undefined> | OmpToolCallResult | undefined;
  toolResult?: (event: OmpToolResultEvent, ctx: OmpContext) => Promise<unknown> | unknown;
  sessionStop?: (
    event: OmpSessionStopEvent,
    ctx: OmpContext,
  ) => Promise<OmpSessionStopResult | undefined> | OmpSessionStopResult | undefined;
}

function fakeOmp(): Handlers {
  const handlers: Handlers = {};
  const pi = {
    on(event: string, handler: unknown) {
      if (event === "session_start") handlers.sessionStart = handler as Handlers["sessionStart"];
      if (event === "tool_call") handlers.toolCall = handler as Handlers["toolCall"];
      if (event === "tool_result") handlers.toolResult = handler as Handlers["toolResult"];
      if (event === "session_stop") handlers.sessionStop = handler as Handlers["sessionStop"];
    },
  } as unknown as OmpExtensionApi;
  register(pi);
  return handlers;
}

const dirs: string[] = [];
const saved = { policy: process.env.JIG_POLICY_FILE, state: process.env.JIG_STATE_DIR };

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  process.env.JIG_POLICY_FILE = saved.policy;
  process.env.JIG_STATE_DIR = saved.state;
});

describe("the extension omp loads", () => {
  test("subscribes exactly the four events the decision allows", () => {
    const handlers = fakeOmp();
    expect(Object.keys(handlers).sort()).toEqual([
      "sessionStart",
      "sessionStop",
      "toolCall",
      "toolResult",
    ]);
  });

  test("guards a real call through jig's core and notes the session's model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jig-omp-e2e-"));
    dirs.push(dir);
    const policy = join(dir, "guard-rules.json");
    writeFileSync(policy, JSON.stringify(POLICY));
    process.env.JIG_POLICY_FILE = policy;
    process.env.JIG_STATE_DIR = join(dir, "state");

    const handlers = fakeOmp();
    const ctx: OmpContext = {
      cwd: dir,
      hasUI: false,
      sessionManager: { getSessionId: () => "omp-e2e" },
      model: { id: "anthropic/claude-opus-5" },
    };

    await handlers.sessionStart?.({ type: "session_start" }, ctx);
    const sessions = readFileSync(join(dir, "state", "sessions.jsonl"), "utf8");
    expect(JSON.parse(sessions.trim())).toMatchObject({
      session_id: "omp-e2e",
      harness: "omp",
      model: "anthropic/claude-opus-5",
      source: "startup",
    });

    const denied = await handlers.toolCall?.(
      { toolName: "bash", input: { command: "rm -rf /tmp/x" }, toolCallId: "c1" },
      ctx,
    );
    expect(denied?.block).toBe(true);
    expect(denied?.reason).toContain("recursive force delete");

    const allowed = await handlers.toolCall?.(
      { toolName: "bash", input: { command: "git status" } },
      ctx,
    );
    expect(allowed).toBeUndefined();

    // The judgment reached the audit log the core owns.
    const audit = readFileSync(join(dir, "state", "guard-audit.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(audit).toHaveLength(2);
    expect(JSON.parse(audit[0] as string)).toMatchObject({
      principal: { harness: "omp", sessionId: "omp-e2e" },
      decision: "deny",
    });
  });

  test("the result and stop handlers stay silent when there is nothing to say", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jig-omp-quiet-"));
    dirs.push(dir);
    const handlers = fakeOmp();
    const ctx: OmpContext = { cwd: dir, hasUI: false };
    expect(await handlers.toolResult?.({ toolName: "grep", input: {} }, ctx)).toBeUndefined();
    // An empty directory detects no project, so the gate has no check to run.
    expect(await handlers.sessionStop?.({ session_id: "s" }, ctx)).toBeUndefined();
  });
});
