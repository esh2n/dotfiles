import { describe, expect, test } from "bun:test";
import { userPromptSubmit } from "../../src/cli/hooks/user-prompt-submit";
import type { SkillCandidate } from "../../src/domain/skills/candidate";
import type { RouterLogEntry } from "../../src/domain/skills/router-log";
import { StaticProvider } from "../../src/infra/decision/static-provider";

const candidates: readonly SkillCandidate[] = [
  {
    name: "ui-capture",
    description: "screenshots of a web UI",
    path: "/skills/ui-capture/SKILL.md",
  },
  { name: "writeup", description: "documents that are kept", path: "/skills/writeup/SKILL.md" },
  { name: "golang-patterns", description: "Go idioms", path: "/skills/golang-patterns/SKILL.md" },
];

/** What the judgment answers per candidate, by name; anything else answers `false`. */
type Answers = Readonly<Record<string, readonly [boolean, number]>>;

/**
 * Deps whose provider answers one boolean per candidate. The answers are keyed by the ask
 * order the hook uses (the catalog), so a test states what each skill was judged to be.
 */
function deps(
  answers: Answers,
  recorded: RouterLogEntry[],
  env: Record<string, string | undefined> = {},
) {
  return {
    provider: new StaticProvider({
      bools: candidates.map((candidate) => {
        const [value, confidence] = answers[candidate.name] ?? [false, 1];
        return { value, confidence };
      }),
    }),
    catalog: async () => candidates,
    record: async (entry: RouterLogEntry) => {
      recorded.push(entry);
    },
    env,
  };
}

describe("userPromptSubmit", () => {
  test("injects the matched skill as context, with its path rather than its body", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "このページのスクショを撮って" }),
      deps({ "ui-capture": [true, 0.96] }, recorded),
    );

    const parsed = JSON.parse(output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("1 skill matches");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      '- "ui-capture": /skills/ui-capture/SKILL.md',
    );
    expect(recorded[0]?.skills).toEqual(["ui-capture"]);
    expect(recorded[0]?.source).toBe("decided");
  });

  test("injects every skill the judgment named, strongest first", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "この設計をレビューして。Goの性能も見て" }),
      deps({ "ui-capture": [true, 0.81], writeup: [true, 0.94] }, recorded),
    );

    const context = (JSON.parse(output) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    // The order is the answer's, not the catalog's: a reader deciding what to open first
    // should see the strongest pick first, and the log keeps the same order.
    expect(context).toContain("2 skills match this request (judgment confidence 0.94, 0.81)");
    expect(context.indexOf('"writeup"')).toBeLessThan(context.indexOf('"ui-capture"'));
    expect(recorded[0]?.skills).toEqual(["writeup", "ui-capture"]);
    expect(recorded[0]?.passed).toBe(2);
  });

  test("records how many passed the gate, so a cap that hides picks is visible", async () => {
    const recorded: RouterLogEntry[] = [];
    await userPromptSubmit(
      JSON.stringify({ prompt: "何かの依頼" }),
      deps(
        {
          "ui-capture": [true, 0.95],
          writeup: [true, 0.94],
          "golang-patterns": [true, 0.93],
        },
        recorded,
      ),
    );

    // Three cleared the gate and all three are handed over (the cap is 3), which is the
    // state a fourth pick would have to be cut from.
    expect(recorded[0]?.passed).toBe(3);
    expect(recorded[0]?.skills).toEqual(["ui-capture", "writeup", "golang-patterns"]);
  });

  test("stays silent when the judgment says nothing applies, but still records it", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "今日の天気を教えて" }),
      deps({}, recorded),
    );

    expect(output).toBe("");
    expect(recorded[0]?.skills).toEqual([]);
    // The judgment answered "nothing applies" — that is a decision, not a failure to decide.
    expect(recorded[0]?.source).toBe("decided");
  });

  test("stays silent when confidence does not clear the gate", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "何か" }),
      deps({ "ui-capture": [true, 0.3] }, recorded),
    );

    expect(output).toBe("");
    // Yes at 0.30: the judgment named a skill and the gate did not accept it.
    expect(recorded[0]?.source).toBe("fallback");
    expect(recorded[0]?.confidence).toBeCloseTo(0.3);
  });

  test("stays silent on a payload it cannot parse", async () => {
    const recorded: RouterLogEntry[] = [];
    expect(await userPromptSubmit("{ not json", deps({}, recorded))).toBe("");
    expect(recorded).toEqual([]);
  });

  test("stays silent on an empty prompt rather than spending a judgment", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "   " }),
      deps({ "ui-capture": [true, 1] }, recorded),
    );

    expect(output).toBe("");
    expect(recorded).toEqual([]);
  });

  test("can be switched off without consulting the judgment", async () => {
    const recorded: RouterLogEntry[] = [];
    const off = deps({ "ui-capture": [true, 1] }, recorded);
    off.env = { JIG_SKILL_ROUTER: "off" };

    expect(await userPromptSubmit(JSON.stringify({ prompt: "スクショ撮って" }), off)).toBe("");
    expect(recorded).toEqual([]);
  });

  test("records an identity for the prompt, so repeats can be told from look-alikes", async () => {
    const first: RouterLogEntry[] = [];
    const second: RouterLogEntry[] = [];
    const different: RouterLogEntry[] = [];
    const same = JSON.stringify({ prompt: "同じ依頼" });

    await userPromptSubmit(same, deps({ "ui-capture": [true, 0.9] }, first));
    await userPromptSubmit(same, deps({ "ui-capture": [true, 0.9] }, second));
    await userPromptSubmit(
      JSON.stringify({ prompt: "同じ依頼 " }),
      deps({ "ui-capture": [true, 0.9] }, different),
    );

    expect(String(first[0]?.promptHash)).toMatch(/^[0-9a-f]{12}$/);
    expect(first[0]?.promptHash).toBe(second[0]?.promptHash);
    expect(first[0]?.promptHash).not.toBe(different[0]?.promptHash);
  });

  test("labels the line with the harness its wrapper declared", async () => {
    const recorded: RouterLogEntry[] = [];
    await userPromptSubmit(
      JSON.stringify({ prompt: "決定記録をまとめて" }),
      deps({ writeup: [true, 0.9] }, recorded, { JIG_HARNESS: "claude" }),
    );

    const anonymous: RouterLogEntry[] = [];
    await userPromptSubmit(
      JSON.stringify({ prompt: "決定記録をまとめて" }),
      deps({ writeup: [true, 0.9] }, anonymous),
    );

    // The wrapper knows which harness it runs in; the hook cannot, so it never guesses.
    expect(recorded[0]?.harness).toBe("claude");
    expect(anonymous[0]?.harness).toBe("unknown");
  });

  test("times the judgment, so the log can say what routing costs in latency", async () => {
    const recorded: RouterLogEntry[] = [];
    await userPromptSubmit(
      JSON.stringify({ prompt: "スクショ撮って" }),
      deps({ "ui-capture": [true, 0.96] }, recorded),
    );

    expect(typeof recorded[0]?.latency_ms).toBe("number");
    expect(recorded[0]?.latency_ms).toBeGreaterThanOrEqual(0);
    // Not `usage`: this path decides through `/decide`, whose reply carries no token counts.
    // The service-side `/skill` writer is the one that can record cost.
    expect(recorded[0]?.usage).toBeUndefined();
  });

  test("a failing judgment leaves the prompt untouched and is recorded", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(JSON.stringify({ prompt: "スクショ撮って" }), {
      ...deps({ "ui-capture": [true, 1] }, recorded),
      catalog: async () => {
        throw new Error("judgment service unreachable");
      },
    });

    expect(output).toBe("");
    expect(String(recorded[0]?.error)).toContain("unreachable");
  });
});

/**
 * The prompts below are the real heads of prompts the router routed in the 30-day window
 * the 2026-09-22 investigation read, personal content redacted. 167 of 209 injections landed
 * on text of these shapes, at follow rates of 0.0-2.1%.
 */
describe("userPromptSubmit on prompts that are not human requests", () => {
  const notHuman: readonly (readonly [string, string, string])[] = [
    [
      "hook-event",
      "hook-event replay",
      "[MESSAGE FROM NON-USER SOURCE - NOT USER INPUT]\nHello memory agent, you are continuing to observe the primary Claude session.",
    ],
    [
      "compaction",
      "Claude Code's own compaction prompt",
      "Below is a conversation log from a Claude Code coding session.\nCreate a summary to help the next session quickly understand the context.",
    ],
    [
      "session-resume",
      "a continued session's summary",
      "This session is being continued from a previous conversation that ran out of context.",
    ],
    [
      "agent-message",
      "an agent-to-agent relay",
      'Another Claude session sent a message:\n<agent-message from="a28ae7aa3286b3b3d">\n[Subagent hand-back] (report)',
    ],
    [
      "task-notification",
      "a subagent completion notification",
      "<task-notification>\n<task-id>aa32e9c0a8825c8ca</task-id>\n<status>completed</status>\n</task-notification>",
    ],
    [
      "skill-body",
      "a skill body replayed as a prompt",
      "Base directory for this skill: /Users/x/.claude/skills/retrospective-codify\n\n# Retrospective Codify",
    ],
  ];

  for (const [reason, what, prompt] of notHuman) {
    test(`returns no opinion on ${what}, and records the skip`, async () => {
      const recorded: RouterLogEntry[] = [];
      const output = await userPromptSubmit(
        JSON.stringify({ prompt }),
        // The judgment would have said yes at 0.96. It is never asked.
        deps({ "ui-capture": [true, 0.96], writeup: [true, 0.96] }, recorded),
      );

      expect(output).toBe("");
      // The skip is on the line, because a skip and a decline are the same silence in a
      // transcript — without this, a signature eating real requests would be invisible.
      expect(recorded[0]?.skipped).toBe(reason);
      expect(recorded[0]?.skills).toBeUndefined();
      expect(recorded[0]?.promptHash).toMatch(/^[0-9a-f]{12}$/);
    });
  }

  test("returns no opinion inside a subagent, on the hook's own fields", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({
        prompt: "この設計をレビューして",
        agent_type: "Explore",
        agent_id: "a28ae7aa3286b3b3d",
      }),
      deps({ writeup: [true, 0.96] }, recorded),
    );

    expect(output).toBe("");
    expect(recorded[0]?.skipped).toBe("subagent");
  });

  test("still routes a request that merely looks automated", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "$ sbx run --posture guarded\nError: mount failed\nこれ直して" }),
      deps({ writeup: [true, 0.96] }, recorded),
    );

    expect(output).not.toBe("");
    expect(recorded[0]?.skipped).toBeUndefined();
  });
});

describe("the reminder's wording", () => {
  async function contextFor(harness: string | undefined): Promise<string> {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "決定記録をまとめて" }),
      deps({ writeup: [true, 0.91] }, recorded),
      harness === undefined ? {} : { harness },
    );
    return (JSON.parse(output) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
  }

  test("names the Skill tool for Claude Code, keeping the path as the secondary route", async () => {
    const context = await contextFor("claude");

    // All 209 injections measured on 2026-09-22 named a path and none named the tool the
    // harness actually loads a skill with.
    expect(context).toContain("Skill tool");
    expect(context).toContain("`Skill(<name>)`");
    expect(context).toContain("`/<name>`");
    // The path stays, second: the body is the same file either way.
    expect(context).toContain('- "writeup": /skills/writeup/SKILL.md');
    expect(context.indexOf("Skill tool")).toBeLessThan(context.indexOf("/skills/writeup"));
  });

  test("keeps the path-only wording for a harness that has not said who it is", async () => {
    // Naming a tool that does not exist in the harness is worse than naming none.
    const context = await contextFor(undefined);

    expect(context).toContain("Read and follow these before doing the work:");
    expect(context).not.toContain("Skill tool");
    expect(context).toContain('- "writeup": /skills/writeup/SKILL.md');
  });

  test("takes the harness from the flag over the environment, as pre-tool-use does", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "決定記録をまとめて" }),
      deps({ writeup: [true, 0.91] }, recorded, { JIG_HARNESS: "pi" }),
      { harness: "claude" },
    );

    const context = (JSON.parse(output) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(context).toContain("Skill tool");
    expect(recorded[0]?.harness).toBe("claude");
  });
});
