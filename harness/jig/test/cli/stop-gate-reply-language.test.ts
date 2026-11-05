import { describe, expect, test } from "bun:test";
import { type ReplyLanguageDeps, stopGate } from "../../src/cli/hooks/stop-gate";
import type { Runner } from "../../src/domain/hooks/run";

const passing: Runner = async () => ({ code: 0, stdout: "", stderr: "", missing: false });
const noProject = () => false;

const ENGLISH =
  "The code review is back with 3 findings. One of them is a real bug in the early return, so I am fixing it now.";
const ENGLISH_BETWEEN_TOOLS =
  "Before running the full check, I first confirm that a broken rule makes the lint fail.";
const JAPANESE =
  "コードレビューの指摘は3件で、そのうち1件は early return の本物の不具合なので、いま `stop-gate.ts` を直しています。";

const TRANSCRIPT = "/t/session.jsonl";

const jsonl = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n");
const prompt = (text: string) => ({ type: "user", message: { content: text } });
const said = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});
const toolResult = { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } };
const agentCall = {
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Agent" }] },
};
const taskNotification = {
  type: "user",
  origin: { kind: "task-notification" },
  message: { content: "<task-notification>\n<task-id>a1</task-id>" },
};
const AFTER_AGENT =
  "I've asked an agent to build this. Once it's ready, I'll send the Storybook address that opens on your phone.";

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    cwd: "/repo",
    stop_hook_active: false,
    transcript_path: TRANSCRIPT,
    last_assistant_message: ENGLISH,
    ...over,
  });

function language(setting: unknown, transcript = ""): ReplyLanguageDeps {
  return {
    setting: async () => setting,
    readTranscript: async (path) => {
      if (path !== TRANSCRIPT) throw new Error(`ENOENT: ${path}`);
      return transcript;
    },
  };
}

const blocked = (out: string): { decision: string; reason: string } =>
  JSON.parse(out) as { decision: string; reason: string };

describe("the turn's texts across tool calls and wake-ups", () => {
  test("a short English final reply after an Agent call blocks, naming that reply", async () => {
    const transcript = jsonl(
      prompt("スクショについても言ったよね"),
      said(ENGLISH),
      agentCall,
      toolResult,
    );
    const decision = blocked(
      await stopGate(payload({ last_assistant_message: AFTER_AGENT }), {
        run: passing,
        exists: noProject,
        replyLanguage: language("Japanese", transcript),
      }),
    );
    expect(decision.reason).toContain("I've asked an agent to build this");
    expect(decision.reason).toContain("The code review is back");
  });

  test("a task-notification wake-up does not start a new turn: English written before it still counts", async () => {
    const transcript = jsonl(
      prompt("直して"),
      said(ENGLISH_BETWEEN_TOOLS),
      taskNotification,
      said(JAPANESE),
    );
    const decision = blocked(
      await stopGate(payload({ last_assistant_message: JAPANESE }), {
        run: passing,
        exists: noProject,
        replyLanguage: language("Japanese", transcript),
      }),
    );
    expect(decision.reason).toContain("Before running the full check");
  });

  test("a passage an earlier stop of the turn already named is not named again", async () => {
    const named = {
      type: "user",
      isMeta: true,
      message: { content: `Stop hook feedback:\njig gate: ...\n1. "${ENGLISH_BETWEEN_TOOLS}"` },
    };
    const transcript = jsonl(
      prompt("直して"),
      said(ENGLISH_BETWEEN_TOOLS),
      named,
      said(JAPANESE),
      taskNotification,
      said(JAPANESE),
    );
    expect(
      await stopGate(payload({ last_assistant_message: JAPANESE }), {
        run: passing,
        exists: noProject,
        replyLanguage: language("Japanese", transcript),
      }),
    ).toBe("");
  });
  test("a passage the guard already denied before a tool call is not named again", async () => {
    const denied = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            is_error: true,
            content: [
              {
                type: "text",
                text: `jig guard (reply language): Claude Code's \`language\` setting asks for Japanese, but ...\n"${ENGLISH_BETWEEN_TOOLS}"`,
              },
            ],
          },
        ],
      },
    };
    const transcript = jsonl(
      prompt("直して"),
      said(ENGLISH_BETWEEN_TOOLS),
      agentCall,
      denied,
      said(JAPANESE),
    );
    expect(
      await stopGate(payload({ last_assistant_message: JAPANESE }), {
        run: passing,
        exists: noProject,
        replyLanguage: language("Japanese", transcript),
      }),
    ).toBe("");
  });

  test("an ordinary tool result quoting a passage does not count as naming it", async () => {
    const quoted = {
      type: "user",
      message: { content: [{ type: "tool_result", content: ENGLISH_BETWEEN_TOOLS }] },
    };
    const transcript = jsonl(prompt("直して"), said(ENGLISH_BETWEEN_TOOLS), agentCall, quoted);
    const out = await stopGate(payload({ last_assistant_message: JAPANESE }), {
      run: passing,
      exists: noProject,
      replyLanguage: language("Japanese", transcript),
    });
    expect(blocked(out).reason).toContain("Before running the full check");
  });
});

describe("the reply-language check", () => {
  test("a final reply mostly in English under a Japanese setting blocks, quoting it", async () => {
    const out = await stopGate(payload(), {
      run: passing,
      exists: noProject,
      replyLanguage: language("Japanese"),
    });
    const decision = blocked(out);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("in Japanese");
    expect(decision.reason).toContain("The code review is back");
  });

  test("a Japanese final reply after English text between tool calls blocks, naming that text", async () => {
    const transcript = jsonl(
      prompt("直して"),
      said(ENGLISH_BETWEEN_TOOLS),
      toolResult,
      said(JAPANESE),
    );
    const out = await stopGate(payload({ last_assistant_message: JAPANESE }), {
      run: passing,
      exists: noProject,
      replyLanguage: language("Japanese", transcript),
    });
    const decision = blocked(out);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("Before running the full check");
    expect(decision.reason).not.toContain("コードレビュー");
  });

  test("English text from an earlier turn does not count", async () => {
    const transcript = jsonl(prompt("前の依頼"), said(ENGLISH_BETWEEN_TOOLS), prompt("次の依頼"));
    expect(
      await stopGate(payload({ last_assistant_message: JAPANESE }), {
        run: passing,
        exists: noProject,
        replyLanguage: language("Japanese", transcript),
      }),
    ).toBe("");
  });

  test("the final reply is judged even when the transcript has not caught up with it", async () => {
    const transcript = jsonl(prompt("直して"), said(JAPANESE));
    const out = await stopGate(payload(), {
      run: passing,
      exists: noProject,
      replyLanguage: language("Japanese", transcript),
    });
    expect(blocked(out).reason).toContain("The code review is back");
  });

  test("a turn written in Japanese lets the turn end", async () => {
    const transcript = jsonl(prompt("直して"), said(JAPANESE), toolResult, said(JAPANESE));
    expect(
      await stopGate(payload({ last_assistant_message: JAPANESE }), {
        run: passing,
        exists: noProject,
        replyLanguage: language("Japanese", transcript),
      }),
    ).toBe("");
  });

  test("after a hook-forced continuation it does not fire again", async () => {
    expect(
      await stopGate(payload({ stop_hook_active: true }), {
        run: passing,
        exists: noProject,
        replyLanguage: language("Japanese", jsonl(prompt("p"), said(ENGLISH_BETWEEN_TOOLS))),
      }),
    ).toBe("");
  });

  test("no setting, an unsupported or unreadable one, or nothing to read: the turn ends", async () => {
    const unreadable: ReplyLanguageDeps = {
      setting: async () => {
        throw new Error("EACCES");
      },
      readTranscript: async () => "",
    };
    const cases: [string, ReplyLanguageDeps | undefined][] = [
      [payload(), undefined],
      [payload(), language(undefined)],
      [payload(), language("French")],
      [payload(), unreadable],
      [
        payload({ last_assistant_message: undefined, transcript_path: undefined }),
        language("Japanese"),
      ],
    ];
    for (const [input, replyLanguage] of cases) {
      const deps = replyLanguage === undefined ? {} : { replyLanguage };
      expect(await stopGate(input, { run: passing, exists: noProject, ...deps })).toBe("");
    }
  });

  test("an unreadable transcript still judges the final reply", async () => {
    const out = await stopGate(payload({ transcript_path: "/missing.jsonl" }), {
      run: passing,
      exists: noProject,
      replyLanguage: language("Japanese"),
    });
    expect(blocked(out).reason).toContain("The code review is back");
  });

  test("a failing typecheck and an off-language reply are one block with both reasons", async () => {
    const failing: Runner = async () => ({
      code: 2,
      stdout: "src/a.ts(3,1): error TS2304",
      stderr: "",
      missing: false,
    });
    const decision = blocked(
      await stopGate(payload(), {
        run: failing,
        exists: (path) => path === "/repo/tsconfig.json",
        replyLanguage: language("Japanese"),
      }),
    );
    expect(decision.reason).toContain("error TS2304");
    expect(decision.reason).toContain("in Japanese");
  });
});
