import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeHooks } from "../../src/domain/claude/hooks";

// The real entry, as the hooks run it: the recorders and the gate meet only through the
// state directory, so only a run of `jig.ts` itself shows that they agree on it.
const JIG = join(import.meta.dir, "..", "..", "src", "cli", "jig.ts");

const root = await mkdtemp(join(tmpdir(), "jig-wiring-"));
afterAll(() => rm(root, { recursive: true, force: true }));

async function hook(
  subcommand: string,
  payload: unknown,
  env: Record<string, string>,
): Promise<{ readonly code: number; readonly stdout: string }> {
  const proc = Bun.spawn([process.execPath, JIG, "hooks", subcommand, "--harness", "claude"], {
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout };
}

describe("the findings hooks through jig.ts", () => {
  test("a Skill call and a reviewer's report are read back by the Stop gate", async () => {
    const skills = join(root, "skills");
    await mkdir(join(skills, "probe-review"), { recursive: true });
    await writeFile(
      join(skills, "probe-review", "SKILL.md"),
      "---\nname: probe-review\ndescription: d\nmetadata:\n  findings-reporters: [code-reviewer]\n  findings-verifier: review-verifier\n---\n# x\n",
    );
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const env = {
      JIG_STATE_DIR: join(root, "state"),
      JIG_SKILL_ROOT: skills,
      CLAUDE_CONFIG_DIR: join(root, "no-claude"),
    };
    const session = { session_id: "wiring-1", cwd: project };

    const used = await hook(
      "post-tool-use-format",
      { ...session, tool_name: "Skill", tool_input: { skill: "probe-review" } },
      env,
    );
    const reported = await hook(
      "subagent-stop",
      {
        ...session,
        agent_id: "a1",
        agent_type: "code-reviewer",
        last_assistant_message: "## Findings\n1. x\n\nFindings: 1",
      },
      env,
    );
    expect([used.code, reported.code]).toEqual([0, 0]);

    const stop = await hook("stop-gate", { ...session, stop_hook_active: false }, env);
    expect(JSON.parse(stop.stdout).decision).toBe("block");
    expect(JSON.parse(stop.stdout).reason).toContain("review-verifier");
  });

  test("a state directory that cannot be written does not fail the hook", async () => {
    const file = join(root, "not-a-dir");
    await writeFile(file, "");
    const result = await hook(
      "subagent-stop",
      { session_id: "wiring-2", agent_type: "code-reviewer", last_assistant_message: "x" },
      { JIG_STATE_DIR: file },
    );
    expect(result).toEqual({ code: 0, stdout: "" });
    expect(await readFile(file, "utf8")).toBe("");
  });

  describe("the Stop gate reads the settings at CLAUDE_CONFIG_DIR", () => {
    const gate = async (name: string, settings: string | undefined) => {
      const dir = join(root, name);
      await mkdir(dir, { recursive: true });
      if (settings !== undefined) await writeFile(join(dir, "settings.json"), settings);
      return hook(
        "stop-gate",
        { session_id: `settings-${name}`, cwd: root, stop_hook_active: false },
        { JIG_STATE_DIR: join(root, `state-${name}`), CLAUDE_CONFIG_DIR: dir },
      );
    };

    test("settings without the recorders are told to the owner, without a block", async () => {
      const result = await gate("old", JSON.stringify({ hooks: {} }));
      const message = JSON.parse(result.stdout) as Record<string, string>;
      expect(message.decision).toBeUndefined();
      expect(message.systemMessage).toContain(join(root, "old", "settings.json"));
      expect(message.systemMessage).toContain("SubagentStop");
    });

    test("settings as jig writes them, a missing file and broken JSON say nothing", async () => {
      const good = JSON.stringify({ hooks: buildClaudeHooks({ bun: "/b", jig: "/j/jig.ts" }) });
      for (const [name, settings] of [
        ["good", good],
        ["missing", undefined],
        ["broken", "{not json"],
      ] as const) {
        expect({ name, ...(await gate(name, settings)) }).toEqual({ name, code: 0, stdout: "" });
      }
    });
  });
});
