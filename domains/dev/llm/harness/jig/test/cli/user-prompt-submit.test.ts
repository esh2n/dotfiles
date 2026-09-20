import { describe, expect, test } from "bun:test";
import type { SkillCandidate } from "../../src/app/routing/select-skill";
import { userPromptSubmit } from "../../src/cli/hooks/user-prompt-submit";
import type { RouterLogEntry } from "../../src/domain/skills/router-log";
import { StaticProvider } from "../../src/infra/decision/static-provider";

const candidates: readonly SkillCandidate[] = [
  {
    name: "ui-capture",
    description: "screenshots of a web UI",
    path: "/skills/ui-capture/SKILL.md",
  },
  { name: "writeup", description: "documents that are kept", path: "/skills/writeup/SKILL.md" },
];

function deps(
  choice: { value: string; confidence: number },
  recorded: RouterLogEntry[],
  env: Record<string, string | undefined> = {},
) {
  return {
    provider: new StaticProvider({ choice }),
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
      deps({ value: "ui-capture", confidence: 0.96 }, recorded),
    );

    const parsed = JSON.parse(output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain('"ui-capture" skill');
    expect(parsed.hookSpecificOutput.additionalContext).toContain("/skills/ui-capture/SKILL.md");
    expect(recorded[0]?.skill).toBe("ui-capture");
    expect(recorded[0]?.source).toBe("decided");
  });

  test("stays silent when the judgment says nothing applies, but still records it", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "今日の天気を教えて" }),
      deps({ value: "none", confidence: 0.99 }, recorded),
    );

    expect(output).toBe("");
    expect(recorded[0]?.skill).toBeNull();
  });

  test("stays silent when confidence does not clear the gate", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "何か" }),
      deps({ value: "ui-capture", confidence: 0.3 }, recorded),
    );

    expect(output).toBe("");
    expect(recorded[0]?.source).toBe("fallback");
  });

  test("stays silent on a payload it cannot parse", async () => {
    const recorded: RouterLogEntry[] = [];
    expect(
      await userPromptSubmit("{ not json", deps({ value: "ui-capture", confidence: 1 }, recorded)),
    ).toBe("");
    expect(recorded).toEqual([]);
  });

  test("stays silent on an empty prompt rather than spending a judgment", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(
      JSON.stringify({ prompt: "   " }),
      deps({ value: "ui-capture", confidence: 1 }, recorded),
    );

    expect(output).toBe("");
    expect(recorded).toEqual([]);
  });

  test("can be switched off without consulting the judgment", async () => {
    const recorded: RouterLogEntry[] = [];
    const off = deps({ value: "ui-capture", confidence: 1 }, recorded);
    off.env = { JIG_SKILL_ROUTER: "off" };

    expect(await userPromptSubmit(JSON.stringify({ prompt: "スクショ撮って" }), off)).toBe("");
    expect(recorded).toEqual([]);
  });

  test("records an identity for the prompt, so repeats can be told from look-alikes", async () => {
    const first: RouterLogEntry[] = [];
    const second: RouterLogEntry[] = [];
    const different: RouterLogEntry[] = [];
    const same = JSON.stringify({ prompt: "同じ依頼" });

    await userPromptSubmit(same, deps({ value: "ui-capture", confidence: 0.9 }, first));
    await userPromptSubmit(same, deps({ value: "ui-capture", confidence: 0.9 }, second));
    await userPromptSubmit(
      JSON.stringify({ prompt: "同じ依頼 " }),
      deps({ value: "ui-capture", confidence: 0.9 }, different),
    );

    expect(String(first[0]?.promptHash)).toMatch(/^[0-9a-f]{12}$/);
    expect(first[0]?.promptHash).toBe(second[0]?.promptHash);
    expect(first[0]?.promptHash).not.toBe(different[0]?.promptHash);
  });

  test("labels the line with the harness its wrapper declared", async () => {
    const recorded: RouterLogEntry[] = [];
    await userPromptSubmit(
      JSON.stringify({ prompt: "決定記録をまとめて" }),
      deps({ value: "writeup", confidence: 0.9 }, recorded, { JIG_HARNESS: "claude" }),
    );

    const anonymous: RouterLogEntry[] = [];
    await userPromptSubmit(
      JSON.stringify({ prompt: "決定記録をまとめて" }),
      deps({ value: "writeup", confidence: 0.9 }, anonymous),
    );

    // The wrapper knows which harness it runs in; the hook cannot, so it never guesses.
    expect(recorded[0]?.harness).toBe("claude");
    expect(anonymous[0]?.harness).toBe("unknown");
  });

  test("a failing judgment leaves the prompt untouched and is recorded", async () => {
    const recorded: RouterLogEntry[] = [];
    const output = await userPromptSubmit(JSON.stringify({ prompt: "スクショ撮って" }), {
      ...deps({ value: "ui-capture", confidence: 1 }, recorded),
      catalog: async () => {
        throw new Error("judgment service unreachable");
      },
    });

    expect(output).toBe("");
    expect(String(recorded[0]?.error)).toContain("unreachable");
  });
});
