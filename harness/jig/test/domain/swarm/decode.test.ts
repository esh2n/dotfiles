import { describe, expect, test } from "bun:test";
import { decodeWorkerLine } from "../../../src/domain/swarm/decode";

const line = (event: unknown) => JSON.stringify(event);

describe("a worker's JSONL stream (pi and omp)", () => {
  test("turns and tool calls are counted", () => {
    expect(decodeWorkerLine(line({ type: "turn_start" }))).toEqual([
      { kind: "progress", progress: { turn: true } },
    ]);
    expect(
      decodeWorkerLine(
        line({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: {} }),
      ),
    ).toEqual([{ kind: "progress", progress: { toolCall: true } }]);
  });

  test("a finished assistant message gives usage, cost and text, and a clean verdict", () => {
    const events = decodeWorkerLine(
      line({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "…" },
            { type: "text", text: "Done: " },
            { type: "text", text: "3 files." },
          ],
          usage: {
            input: 1200,
            output: 80,
            cacheRead: 400,
            cacheWrite: 0,
            totalTokens: 1680,
            cost: { total: 0.0021 },
          },
          stopReason: "stop",
        },
      }),
    );
    expect(events).toEqual([
      {
        kind: "progress",
        progress: {
          usage: { input: 1200, output: 80, cacheRead: 400, cacheWrite: 0, cost: 0.0021 },
          text: "Done: 3 files.",
        },
      },
      { kind: "end", text: "Done: 3 files." },
    ]);
  });

  test("a message that ends in a tool call is progress, not a verdict", () => {
    const events = decodeWorkerLine(
      line({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          usage: { input: 1, output: 1 },
          stopReason: "toolUse",
        },
      }),
    );
    expect(events.map((e) => e.kind)).toEqual(["progress"]);
  });

  test("an error stop is a failure with the model's message", () => {
    const events = decodeWorkerLine(
      line({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "429 rate limited",
        },
      }),
    );
    expect(events).toContainEqual({ kind: "end", error: "429 rate limited" });
  });

  test("usage without a cost stays unknown, not zero", () => {
    const [first] = decodeWorkerLine(
      line({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          usage: { input: 5, output: 1 },
          stopReason: "toolUse",
        },
      }),
    );
    expect(first?.kind === "progress" && first.progress.usage?.cost).toBeUndefined();
  });

  test("pi's running usage on message_update is not counted (message_end carries it)", () => {
    expect(
      decodeWorkerLine(
        line({
          type: "message_update",
          usage: { input: 100 },
          assistantMessageEvent: { type: "text_delta", delta: "x" },
        }),
      ),
    ).toEqual([]);
  });

  test("user and tool-result messages, the session header and unknown events change nothing", () => {
    expect(
      decodeWorkerLine(line({ type: "message_end", message: { role: "user", content: "hi" } })),
    ).toEqual([]);
    expect(decodeWorkerLine(line({ type: "session", id: "x" }))).toEqual([]);
    expect(decodeWorkerLine(line({ type: "agent_settled" }))).toEqual([]);
    expect(decodeWorkerLine("not json")).toEqual([]);
  });

  test("retries that gave up are a failure", () => {
    expect(
      decodeWorkerLine(
        line({ type: "auto_retry_end", success: false, attempt: 3, finalError: "529 overloaded" }),
      ),
    ).toEqual([{ kind: "end", error: "529 overloaded" }]);
    expect(decodeWorkerLine(line({ type: "auto_retry_end", success: true, attempt: 2 }))).toEqual(
      [],
    );
  });
});
