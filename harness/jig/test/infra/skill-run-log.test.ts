import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillRunEvent } from "../../src/domain/hooks/findings-check";
import { appendSkillRun, readSkillRuns } from "../../src/infra/logs/skill-run-log";
import { findingsRuleFor } from "../../src/infra/skills/findings-rule";

const event = (at: string): SkillRunEvent => ({
  at,
  session: "s",
  harness: "claude",
  kind: "skill",
  name: "change-review",
});

describe("the skill-run day files", () => {
  test("appends to the day's file and reads it back", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "jig-runs-")), "skill-runs");
    await appendSkillRun(dir, event("2026-10-23T10:00:00.000Z"));
    await appendSkillRun(dir, event("2026-10-24T01:00:00.000Z"));
    expect((await readdir(dir)).sort()).toEqual(["2026-10-23.jsonl", "2026-10-24.jsonl"]);
    expect(await readSkillRuns(dir, new Date("2026-10-24T02:00:00.000Z"))).toHaveLength(2);
  });

  test("files older than 14 days are deleted, not read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jig-runs-"));
    await appendSkillRun(dir, event("2026-10-01T10:00:00.000Z"));
    await appendSkillRun(dir, event("2026-10-20T10:00:00.000Z"));
    const read = await readSkillRuns(dir, new Date("2026-10-23T00:00:00.000Z"));
    expect(read.map((e) => e.at)).toEqual(["2026-10-20T10:00:00.000Z"]);
    expect(await readdir(dir)).toEqual(["2026-10-20.jsonl"]);
  });

  test("a missing directory is no records; a line that is not a record is skipped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jig-runs-"));
    expect(await readSkillRuns(join(dir, "none"), new Date())).toEqual([]);
    await writeFile(join(dir, "2026-10-23.jsonl"), '{"kind":"skill"}\nnot json\n');
    expect(await readSkillRuns(dir, new Date("2026-10-23T12:00:00.000Z"))).toEqual([]);
  });
});

describe("every record kind reads back as written", () => {
  test("subagent with and without id and count, each gate outcome, typecheck", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jig-runs-"));
    const base = { at: "2026-10-23T10:00:00.000Z", session: "s", harness: "claude" };
    const records: SkillRunEvent[] = [
      { ...base, kind: "subagent", agentType: "code-reviewer", agentId: "a1", findings: 0 },
      { ...base, kind: "subagent", agentType: "code-reviewer" },
      ...(["blocked", "unverified", "not-checked"] as const).map(
        (outcome): SkillRunEvent => ({
          ...base,
          kind: "gate",
          skill: "change-review",
          useAt: "2026-10-23T09:00:00.000Z",
          outcome,
        }),
      ),
      { ...base, kind: "typecheck" },
    ];
    for (const record of records) await appendSkillRun(dir, record);
    expect(await readSkillRuns(dir, new Date("2026-10-23T12:00:00.000Z"))).toEqual(records);
    await rm(dir, { recursive: true, force: true });
  });

  test("a gate line with an unknown outcome is not a record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jig-runs-"));
    await writeFile(
      join(dir, "2026-10-23.jsonl"),
      `${JSON.stringify({ at: "2026-10-23T10:00:00.000Z", session: "s", harness: "claude", kind: "gate", skill: "x", useAt: "2026-10-23T09:00:00.000Z", outcome: "maybe" })}\n`,
    );
    expect(await readSkillRuns(dir, new Date("2026-10-23T12:00:00.000Z"))).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("findingsRuleFor", () => {
  test("reads the rule from <root>/<name>/SKILL.md; a path-like name reads nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-skills-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "change-review"));
    await writeFile(
      join(root, "change-review", "SKILL.md"),
      "---\nname: change-review\ndescription: d\nmetadata:\n  findings-reporters: [code-reviewer]\n  findings-verifier: review-verifier\n---\n# x\n",
    );
    expect(findingsRuleFor(root, "change-review")).toEqual({
      reporters: ["code-reviewer"],
      verifier: "review-verifier",
    });
    expect(findingsRuleFor(root, "../change-review")).toBeUndefined();
    expect(findingsRuleFor(root, "missing")).toBeUndefined();
  });
});
