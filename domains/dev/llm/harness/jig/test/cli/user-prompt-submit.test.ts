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
