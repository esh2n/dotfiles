import { describe, expect, test } from "bun:test";
import { applyManagedDir, planManagedDir } from "../../../src/app/apply/delivery";
import { agentPlan, loadPlugins, skillPlan } from "../../../src/app/apply/plugins";
import { fakeClaudeFs } from "./fake-claude-ports";

const H = "/repo/harness";
const P = "/home/u/.local/share/jig/plugins";
const PACK = `${P}/pstack/pstack`;
const SOURCE = JSON.stringify({
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  skills: "pstack/skills",
  agents: "pstack/agents",
  adapter: "pstack/docs/harness/claude-code.md",
  translated: ["Task"],
});
const ADAPTER =
  "| Cursor | Claude Code |\n| --- | --- |\n| `Task` | `Agent` |\n| `AskQuestion` | x |\n";

function seed(withCheckout: boolean) {
  return fakeClaudeFs({
    files: {
      [`${H}/plugins/pstack/source.json`]: SOURCE,
      [`${H}/plugins/README.md`]: "# plugins\n",
      [`${H}/skills/tdd-workflow/SKILL.md`]: "---\nname: tdd-workflow\n---\n",
      [`${H}/skills/arena/SKILL.md`]: "---\nname: arena\n---\n",
      [`${H}/agents/code-reviewer.md`]: "---\nname: code-reviewer\n---\n",
      ...(withCheckout
        ? {
            [`${PACK}/skills/arena/SKILL.md`]: "---\nname: arena\n---\n",
            [`${PACK}/skills/poteto-mode/SKILL.md`]: "---\nname: poteto-mode\n---\n",
            [`${PACK}/agents/poteto-agent.md`]: "---\nname: poteto-agent\n---\n",
            [`${PACK}/docs/harness/claude-code.md`]: ADAPTER,
          }
        : {}),
    },
  });
}

describe("loadPlugins", () => {
  test("reads each pack under harness/plugins and finds its checkout", async () => {
    const { packs } = await loadPlugins(seed(true).ports, H, P);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      dir: `${P}/pstack`,
      present: true,
      skillsDir: `${PACK}/skills`,
      agentsDir: `${PACK}/agents`,
      untranslated: ["AskQuestion"],
    });
  });

  test("a pack not fetched yet is named, absent, and has nothing to translate", async () => {
    const { packs } = await loadPlugins(seed(false).ports, H, P);
    expect(packs[0]).toMatchObject({ present: false, untranslated: [] });
  });

  test("no plugins directory given means no packs", async () => {
    expect(await loadPlugins(seed(true).ports, H, undefined)).toEqual({ packs: [] });
  });

  test("a broken source.json disables that pack only, with the reason", async () => {
    const fs = seed(true);
    fs.files[`${H}/plugins/pstack/source.json`] = JSON.stringify({ repo: "https://x.example/a/b" });
    const { packs } = await loadPlugins(fs.ports, H, P);
    expect(packs[0]).toMatchObject({ name: "pstack", present: false });
    expect(packs[0]?.invalid).toContain('plugin "pstack"');
    const plan = await skillPlan(fs.ports, `${H}/skills`, await loadPlugins(fs.ports, H, P));
    expect(plan.selection.linked).toEqual(["arena", "tdd-workflow"]);
  });
});

describe("skillPlan and agentPlan", () => {
  test("pack skills join the house's; the house keeps a name both have", async () => {
    const fs = seed(true);
    const plan = await skillPlan(fs.ports, `${H}/skills`, await loadPlugins(fs.ports, H, P));
    expect(plan.selection.linked).toEqual(["arena", "poteto-mode", "tdd-workflow"]);
    expect(plan.targetOf("arena")).toBe(`${H}/skills/arena`);
    expect(plan.targetOf("poteto-mode")).toBe(`${PACK}/skills/poteto-mode`);
    expect(plan.selection.excluded.map((e) => e.name)).toEqual(["arena"]);
  });

  test("pack agents join the house's", async () => {
    const fs = seed(true);
    const plan = await agentPlan(fs.ports, `${H}/agents`, await loadPlugins(fs.ports, H, P));
    expect(plan.selection.linked).toEqual(["code-reviewer.md", "poteto-agent.md"]);
    expect(plan.targetOf("poteto-agent.md")).toBe(`${PACK}/agents/poteto-agent.md`);
  });

  test("written to a managed directory, the links point into each tree", async () => {
    const fs = seed(true);
    const plan = await skillPlan(fs.ports, `${H}/skills`, await loadPlugins(fs.ports, H, P));
    const dir = "/home/u/.claude/skills";
    const report = await planManagedDir(fs.ports, {
      dir,
      sourceDir: `${H}/skills`,
      now: new Date(),
      ...plan,
    });
    await applyManagedDir(fs.ports, report);
    expect(fs.links[`${dir}/poteto-mode`]).toBe(`${PACK}/skills/poteto-mode`);
    expect(fs.links[`${dir}/tdd-workflow`]).toBe(`${H}/skills/tdd-workflow`);
  });

  test("once the checkout is gone, its leftover links are stale and go", async () => {
    const fs = seed(false);
    const dir = "/home/u/.claude/skills";
    fs.links[`${dir}/poteto-mode`] = `${PACK}/skills/poteto-mode`;
    const plan = await skillPlan(fs.ports, `${H}/skills`, await loadPlugins(fs.ports, H, P));
    const report = await planManagedDir(fs.ports, {
      dir,
      sourceDir: `${H}/skills`,
      now: new Date(),
      ...plan,
    });
    expect(report.entries.find((e) => e.name === "poteto-mode")?.kind).toBe("stale");
  });

  test("a pack removed from the repository leaves no links behind", async () => {
    const fs = seed(true);
    delete fs.files[`${H}/plugins/pstack/source.json`];
    const dir = "/home/u/.claude/skills";
    fs.links[`${dir}/poteto-mode`] = `${PACK}/skills/poteto-mode`;
    const plan = await skillPlan(fs.ports, `${H}/skills`, await loadPlugins(fs.ports, H, P));
    const report = await planManagedDir(fs.ports, {
      dir,
      sourceDir: `${H}/skills`,
      now: new Date(),
      ...plan,
    });
    expect(report.entries.find((e) => e.name === "poteto-mode")?.kind).toBe("stale");
  });

  test("a pack skill or agent that declares hooks or MCP servers is not linked", async () => {
    const fs = seed(true);
    fs.files[`${PACK}/skills/poteto-mode/SKILL.md`] =
      "---\nname: poteto-mode\nhooks:\n  PreToolUse: []\n---\nbody\n";
    fs.files[`${PACK}/agents/poteto-agent.md`] =
      "---\nname: poteto-agent\nmcpServers:\n  x: {}\n---\n";
    const plugins = await loadPlugins(fs.ports, H, P);
    const skills = await skillPlan(fs.ports, `${H}/skills`, plugins);
    const agents = await agentPlan(fs.ports, `${H}/agents`, plugins);
    expect(skills.selection.linked).not.toContain("poteto-mode");
    expect(skills.selection.excluded.find((e) => e.name === "poteto-mode")?.reason).toContain(
      "declares hooks",
    );
    expect(agents.selection.linked).toEqual(["code-reviewer.md"]);
  });

  test("a pack entry that is a symlink is not linked: it could point anywhere", async () => {
    const fs = seed(true);
    fs.links[`${PACK}/skills/sneaky`] = "/home/u/.ssh";
    fs.files["/home/u/.ssh/SKILL.md"] = "---\nname: sneaky\n---\n";
    const plan = await skillPlan(fs.ports, `${H}/skills`, await loadPlugins(fs.ports, H, P));
    expect(plan.selection.linked).not.toContain("sneaky");
    expect(plan.selection.excluded.find((e) => e.name === "sneaky")?.reason).toContain("symlink");
  });
});
