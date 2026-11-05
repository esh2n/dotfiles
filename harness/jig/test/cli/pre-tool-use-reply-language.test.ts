import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolCallLanguageDeps, preToolUse } from "../../src/cli/hooks/pre-tool-use";
import type { Logger } from "../../src/domain/ports";
import { BunFileSystem } from "../../src/infra/fs/bun-fs";

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const ports = {
  logger: silentLogger,
  fs: new BunFileSystem(),
  clock: { now: () => new Date("2026-11-05T00:00:00Z") },
};

const POLICY = {
  version: 1,
  rules: [
    {
      id: "git-force-push",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "git", argv: "push\\b.*(--force|(^|\\s)-f\\b)" },
      why: "force push is never allowed",
      profiles: ["minimal", "standard", "strict"],
    },
    {
      id: "rm-recursive-force",
      effect: "ask",
      action: "shell.exec",
      subject: { program: "rm", argv: "(^|\\s)-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)\\b" },
      why: "rm -rf requires confirmation",
      profiles: ["standard", "strict"],
    },
  ],
};

const ENGLISH =
  "Before running the full check, I first confirm that a broken rule makes the lint fail.";
const JAPANESE =
  "全体の検査を走らせる前に、壊した規則で `biome check` が失敗することを先に確かめます。";

const TRANSCRIPT = "/t/session.jsonl";
const jsonl = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n");
const prompt = (text: string) => ({ type: "user", message: { content: text } });
const said = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});
const call = (id: string) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name: "Bash" }] },
});
const result = (id: string, content = "ok") => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
});

function deps(
  setting: unknown,
  transcript: () => string,
  claimed = new Set<string>(),
): ToolCallLanguageDeps {
  return {
    setting: async () => setting,
    readTranscriptTail: async (path) => {
      if (path !== TRANSCRIPT) throw new Error(`ENOENT: ${path}`);
      return transcript();
    },
    claimDenial: async (key) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
  };
}

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "ls" },
    session_id: "s1",
    transcript_path: TRANSCRIPT,
    tool_use_id: "t2",
    ...over,
  });

const decision = (out: string) =>
  out === ""
    ? undefined
    : (
        JSON.parse(out) as {
          hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
        }
      ).hookSpecificOutput;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "jig-pre-tool-use-language-"));
  writeFileSync(join(dir, "guard-rules.json"), JSON.stringify(POLICY));
  process.env.JIG_POLICY_FILE = join(dir, "guard-rules.json");
  process.env.JIG_STATE_DIR = dir;
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.JIG_POLICY_FILE;
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.JIG_STATE_DIR;
});

describe("the passage written before a tool call", () => {
  test("an English passage is denied once, quoting it; the same passage is let through after", async () => {
    const transcript = () =>
      jsonl(prompt("直して"), call("t1"), result("t1"), said(ENGLISH), call("t2"));
    const language = deps("Japanese", transcript);

    const first = decision(await preToolUse(payload(), ports, { replyLanguage: language }));
    expect(first?.permissionDecision).toBe("deny");
    expect(first?.permissionDecisionReason).toContain("jig guard (reply language):");
    expect(first?.permissionDecisionReason).toContain("Before running the full check");
    expect(first?.permissionDecisionReason).toContain("in Japanese before running the tool");

    expect(await preToolUse(payload(), ports, { replyLanguage: language })).toBe("");
  });

  test("a Japanese passage passes", async () => {
    const transcript = () => jsonl(prompt("直して"), said(JAPANESE), call("t2"));
    expect(
      await preToolUse(payload(), ports, { replyLanguage: deps("Japanese", transcript) }),
    ).toBe("");
  });

  test("after the denial, a Japanese rewrite lets the retried call through", async () => {
    const claimed = new Set<string>();
    let transcript = jsonl(prompt("直して"), said(ENGLISH), call("t1"));
    const language = deps("ja", () => transcript, claimed);
    expect(
      decision(await preToolUse(payload({ tool_use_id: "t1" }), ports, { replyLanguage: language }))
        ?.permissionDecision,
    ).toBe("deny");

    transcript = jsonl(
      prompt("直して"),
      said(ENGLISH),
      call("t1"),
      result("t1", "jig guard (reply language): ..."),
      said(JAPANESE),
      call("t2"),
    );
    expect(await preToolUse(payload(), ports, { replyLanguage: language })).toBe("");
  });

  test("a new English passage after the denial is a new passage and is denied once too", async () => {
    const claimed = new Set<string>();
    const other = "Now I am going to run the formatter on every file that changed in this commit.";
    const transcript = jsonl(
      prompt("直して"),
      said(ENGLISH),
      call("t1"),
      result("t1"),
      said(other),
    );
    const out = decision(
      await preToolUse(payload(), ports, {
        replyLanguage: deps("Japanese", () => transcript, claimed),
      }),
    );
    expect(out?.permissionDecisionReason).toContain("Now I am going to run the formatter");
    expect(out?.permissionDecisionReason).not.toContain("Before running the full check");
  });

  test("no text since the last tool result passes", async () => {
    const transcript = () => jsonl(prompt("直して"), said(ENGLISH), call("t1"), result("t1"));
    expect(
      await preToolUse(payload(), ports, { replyLanguage: deps("Japanese", transcript) }),
    ).toBe("");
  });

  test("a tail that does not reach back to a tool result or the owner's message passes", async () => {
    const transcript = () => `{"type":"user","message":{"cont\n${jsonl(said(ENGLISH), call("t2"))}`;
    expect(
      await preToolUse(payload(), ports, { replyLanguage: deps("Japanese", transcript) }),
    ).toBe("");
  });
});

describe("when the check does not run", () => {
  const english = () => jsonl(prompt("直して"), said(ENGLISH), call("t2"));

  test("no language setting passes", async () => {
    expect(await preToolUse(payload(), ports, { replyLanguage: deps(undefined, english) })).toBe(
      "",
    );
  });

  test("an unsupported language setting passes", async () => {
    expect(await preToolUse(payload(), ports, { replyLanguage: deps("French", english) })).toBe("");
  });

  test("an unreadable setting passes", async () => {
    const language = {
      ...deps("Japanese", english),
      setting: async () => {
        throw new Error("EACCES");
      },
    };
    expect(await preToolUse(payload(), ports, { replyLanguage: language })).toBe("");
  });

  test("an unreadable transcript passes", async () => {
    expect(
      await preToolUse(payload({ transcript_path: "/missing.jsonl" }), ports, {
        replyLanguage: deps("Japanese", english),
      }),
    ).toBe("");
  });

  test("a denial that cannot be recorded passes, so a passage is never denied twice", async () => {
    const language = {
      ...deps("Japanese", english),
      claimDenial: async () => {
        throw new Error("EROFS");
      },
    };
    expect(await preToolUse(payload(), ports, { replyLanguage: language })).toBe("");
  });

  test("a subagent's call passes: its text is not the owner's to read", async () => {
    expect(
      await preToolUse(payload({ agent_id: "a1" }), ports, {
        replyLanguage: deps("Japanese", english),
      }),
    ).toBe("");
  });

  test("without the dependency (codex and the other harnesses) nothing is checked", async () => {
    expect(await preToolUse(payload(), ports)).toBe("");
  });
});

describe("the guard's verdict comes first", () => {
  const english = () => jsonl(prompt("直して"), said(ENGLISH), call("t2"));

  test("a guard deny stays the guard's deny, and the passage is not used up", async () => {
    const claimed = new Set<string>();
    const out = decision(
      await preToolUse(
        payload({ tool_input: { command: "git push --force origin main" } }),
        ports,
        { replyLanguage: deps("Japanese", english, claimed) },
      ),
    );
    expect(out?.permissionDecision).toBe("deny");
    expect(out?.permissionDecisionReason).toContain("force push");
    expect(out?.permissionDecisionReason).not.toContain("reply language");
    expect(claimed.size).toBe(0);
  });

  test("a guard ask stays an ask", async () => {
    const out = decision(
      await preToolUse(payload({ tool_input: { command: "rm -rf build" } }), ports, {
        replyLanguage: deps("Japanese", english),
      }),
    );
    expect(out?.permissionDecision).toBe("ask");
    expect(out?.permissionDecisionReason).not.toContain("reply language");
  });
});

describe("tools the guard has no rule for (the hook's matcher is `*`)", () => {
  const OTHER_TOOLS: readonly [string, Record<string, unknown>][] = [
    ["Agent", { description: "look around", prompt: "find the matcher" }],
    ["Grep", { pattern: "matcher", path: "/repo" }],
    ["Skill", { skill: "change-review" }],
    ["mcp__claude-artifacts__publish_version", { content: "<!DOCTYPE html>" }],
  ];

  for (const [tool, input] of OTHER_TOOLS) {
    test(`${tool}: an English passage before it is denied once`, async () => {
      const transcript = () => jsonl(prompt("調べて"), said(ENGLISH), call("t2"));
      const language = deps("Japanese", transcript);
      const over = { tool_name: tool, tool_input: input };

      const first = decision(await preToolUse(payload(over), ports, { replyLanguage: language }));
      expect(first?.permissionDecision).toBe("deny");
      expect(first?.permissionDecisionReason).toContain("jig guard (reply language):");
      expect(await preToolUse(payload(over), ports, { replyLanguage: language })).toBe("");
    });

    test(`${tool}: a Japanese passage before it passes`, async () => {
      const transcript = () => jsonl(prompt("調べて"), said(JAPANESE), call("t2"));
      const over = { tool_name: tool, tool_input: input };
      expect(
        await preToolUse(payload(over), ports, { replyLanguage: deps("Japanese", transcript) }),
      ).toBe("");
    });

    test(`${tool}: with no language setting the hook says nothing, as when it did not fire`, async () => {
      const transcript = () => jsonl(prompt("調べて"), said(ENGLISH), call("t2"));
      const over = { tool_name: tool, tool_input: input };
      expect(
        await preToolUse(payload(over), ports, { replyLanguage: deps(undefined, transcript) }),
      ).toBe("");
      expect(await preToolUse(payload(over), ports)).toBe("");
    });
  }
});
