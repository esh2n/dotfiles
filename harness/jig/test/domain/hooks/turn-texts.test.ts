import { describe, expect, test } from "bun:test";
import { currentTurnTexts } from "../../../src/domain/hooks/turn-texts";

const prompt = (text: string) => ({
  type: "user",
  origin: { kind: "human" },
  message: { content: text },
});
const said = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
  ...extra,
});
const toolUse = { type: "assistant", message: { content: [{ type: "tool_use", name: "Agent" }] } };
const toolResult = { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } };
const hookFeedback = (text: string) => ({
  type: "user",
  isMeta: true,
  message: { content: `Stop hook feedback:\n${text}` },
});
const taskNotification = {
  type: "user",
  origin: { kind: "task-notification" },
  message: { content: "<task-notification>\n<task-id>a1</task-id>" },
};
const otherSession = {
  type: "user",
  isMeta: true,
  origin: { kind: "peer" },
  message: { content: "Another Claude session sent a message:" },
};

const jsonl = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n");
const texts = (...entries: unknown[]) => currentTurnTexts(jsonl(...entries)).texts;

describe("the owner's current turn", () => {
  test("starts after the owner's last message and runs across tool calls, in order", () => {
    expect(
      texts(
        prompt("first"),
        said("old turn"),
        prompt("second"),
        said("one"),
        toolUse,
        toolResult,
        said("two"),
      ),
    ).toEqual(["one", "two"]);
  });

  test("hook feedback, task notifications and messages from other sessions do not start it", () => {
    expect(
      texts(
        prompt("p"),
        said("before"),
        hookFeedback("x"),
        said("after feedback"),
        taskNotification,
        said("after a task"),
        otherSession,
        said("after a message"),
      ),
    ).toEqual(["before", "after feedback", "after a task", "after a message"]);
  });

  test("a prompt sent as content blocks starts it", () => {
    const blocks = { type: "user", message: { content: [{ type: "text", text: "p" }] } };
    expect(texts(said("old"), blocks, said("new"))).toEqual(["new"]);
  });

  test("a subagent's sidechain, thinking and broken lines are not its texts", () => {
    const thinking = {
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "x" }] },
    };
    const transcript = `${jsonl(prompt("p"), said("side", { isSidechain: true }), thinking)}\nnot json\n${jsonl(said("main"))}`;
    expect(currentTurnTexts(transcript).texts).toEqual(["main"]);
  });

  test("the Stop hook feedback given in it is returned, and earlier turns' is not", () => {
    const turn = currentTurnTexts(
      jsonl(prompt("a"), hookFeedback("old"), prompt("b"), said("x"), hookFeedback("new")),
    );
    expect(turn.feedback).toEqual(["Stop hook feedback:\nnew"]);
  });

  test("an empty transcript has no turn", () => {
    expect(currentTurnTexts("")).toEqual({ texts: [], feedback: [] });
  });
});
