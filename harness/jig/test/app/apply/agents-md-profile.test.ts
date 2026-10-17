import { describe, expect, test } from "bun:test";
import { buildAgentsMd } from "../../../src/app/apply/delivery";
import { fakeClaudeFs } from "./fake-claude-ports";

const H = "/repo/harness";
const note = [
  "# 決定",
  "",
  "Status: accepted — 裁定",
  "",
  "rule: Register exactly one hook per event.",
  "",
].join("\n");

const seed = () =>
  fakeClaudeFs({
    files: {
      [`${H}/rules/common/10-git.md`]: "## Git\n\ngit rules\n",
      [`${H}/rules/common/20-execution.md`]: "## Execution\n\nnever stop\n",
      [`${H}/rules/common/README.md`]: "# not a rule\n",
      [`${H}/rules/decisions/2026-09-22-hooks.md`]: note,
      [`${H}/profiles/pstack/rules.json`]: JSON.stringify({
        common: ["10-git.md"],
        decisions: false,
      }),
      [`${H}/profiles/pstack/rules/10-pstack.md`]: "## pstack\n\nporteto is the router\n",
    },
  });

describe("buildAgentsMd under a rules profile", () => {
  test("without a profile: every common rule and the decisions, as before", async () => {
    const fs = seed();
    const built = await buildAgentsMd(fs.ports, {
      harnessRoot: H,
      decisions: `${H}/rules/decisions`,
    });
    expect(built.commonFiles).toEqual(["10-git.md", "20-execution.md"]);
    expect(built.content).toContain("never stop");
    expect(built.content).toContain("**Register exactly one hook per event.**");
    expect(built.profile).toBeUndefined();
  });

  test("with the pstack profile: only its common rules, its own rules after, no decisions", async () => {
    const fs = seed();
    const built = await buildAgentsMd(fs.ports, {
      harnessRoot: H,
      decisions: `${H}/rules/decisions`,
      profile: { name: "pstack", dir: `${H}/profiles/pstack` },
    });
    expect(built.profile).toBe("pstack");
    expect(built.commonFiles).toEqual(["10-git.md", "10-pstack.md"]);
    expect(built.content).toContain("(rules profile: pstack)");
    expect(built.content).toContain("git rules");
    expect(built.content).toContain("porteto is the router");
    expect(built.content).not.toContain("never stop");
    expect(built.content).not.toContain("## Decisions");
    expect(built.skipped).toEqual([]);
  });

  test("a profile that names a rule that does not exist stops the build", async () => {
    const fs = seed();
    fs.files[`${H}/profiles/pstack/rules.json`] = JSON.stringify({
      common: ["10-git.md", "99-gone.md"],
      decisions: true,
    });
    await expect(
      buildAgentsMd(fs.ports, {
        harnessRoot: H,
        decisions: `${H}/rules/decisions`,
        profile: { name: "pstack", dir: `${H}/profiles/pstack` },
      }),
    ).rejects.toThrow("99-gone.md");
  });

  test("a profile directory without rules.json stops the build", async () => {
    const fs = seed();
    await expect(
      buildAgentsMd(fs.ports, {
        harnessRoot: H,
        decisions: `${H}/rules/decisions`,
        profile: { name: "nope", dir: `${H}/profiles/nope` },
      }),
    ).rejects.toThrow("rules.json does not exist");
  });
});
