import { describe, expect, test } from "bun:test";
import {
  adapterNames,
  parsePluginSource,
  riskyFrontmatterKeys,
  untranslated,
} from "../../../src/domain/plugins/plugin-source";

const VALID = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  skills: "pstack/skills",
  agents: "pstack/agents",
  adapter: "pstack/docs/harness/claude-code.md",
  translated: ["Task", "AskQuestion"],
};

describe("parsePluginSource", () => {
  test("reads a pack that follows a branch", () => {
    const source = parsePluginSource("pstack", JSON.stringify(VALID));
    expect(source).toEqual({ name: "pstack", ...VALID });
  });

  test("a commit pins the pack; agents and adapter are optional", () => {
    const commit = "019a6a20592c10bf92869e5740368f578a9997fd";
    const source = parsePluginSource(
      "pstack",
      JSON.stringify({ repo: VALID.repo, ref: "main", commit, skills: "skills", translated: [] }),
    );
    expect(source.commit).toBe(commit);
    expect(source.agents).toBeUndefined();
    expect(source.adapter).toBeUndefined();
  });

  test("anything that could reach outside the checkout or GitHub is refused", () => {
    const bad = (patch: Record<string, unknown>) => () =>
      parsePluginSource("pstack", JSON.stringify({ ...VALID, ...patch }));
    expect(bad({ repo: "https://evil.example/x/y" })).toThrow("GitHub");
    expect(bad({ repo: "git@github.com:cursor/plugins" })).toThrow("GitHub");
    expect(bad({ skills: "../skills" })).toThrow("inside the checkout");
    expect(bad({ skills: "/etc" })).toThrow("inside the checkout");
    expect(bad({ agents: "a/../../b" })).toThrow("inside the checkout");
    expect(bad({ ref: "main; rm -rf" })).toThrow("branch name");
    expect(bad({ ref: "-main" })).toThrow("branch name");
    expect(bad({ ref: "main..x" })).toThrow("branch name");
    expect(bad({ commit: "abc" })).toThrow("40 hex");
    expect(bad({ translated: "Task" })).toThrow("translated");
  });

  test("a name that is not a plain directory name is refused", () => {
    expect(() => parsePluginSource("../x", JSON.stringify(VALID))).toThrow("plugin name");
  });

  test("text that is not a JSON object is refused with the plugin named", () => {
    expect(() => parsePluginSource("pstack", "nope")).toThrow('plugin "pstack"');
    expect(() => parsePluginSource("pstack", "[]")).toThrow("object");
  });
});

const ADAPTER = `# Claude Code

| Cursor | Claude Code |
| --- | --- |
| \`Task\` | \`Agent\` |
| \`AskQuestion\` | \`AskUserQuestion\`. In \`-p\` mode it is absent. |
| Open a todolist | Use \`TodoWrite\`. |
| \`Grep\`, \`Glob\` | \`Bash\` with \`rg\`. |

| Cursor | Claude Code |
| --- | --- |
| \`subagent_type: generalPurpose\` | \`subagent_type: "general-purpose"\` |
`;

describe("adapterNames", () => {
  test("takes the Cursor-side names: every code span in each row's first cell", () => {
    expect(adapterNames(ADAPTER)).toEqual([
      "Task",
      "AskQuestion",
      "Grep",
      "Glob",
      "subagent_type: generalPurpose",
    ]);
  });

  test("a row whose first cell has no code span names nothing", () => {
    expect(adapterNames("| Open a todolist | x |\n")).toEqual([]);
  });
});

describe("untranslated", () => {
  test("names the adapter rows the house translation does not cover yet", () => {
    expect(untranslated(ADAPTER, ["Task", "AskQuestion", "Grep", "Glob"])).toEqual([
      "subagent_type: generalPurpose",
    ]);
  });
});

describe("riskyFrontmatterKeys", () => {
  test("finds hooks and mcpServers at the frontmatter's top level", () => {
    expect(
      riskyFrontmatterKeys("---\nname: a\nhooks:\n  Stop: []\nmcpServers: {}\n---\nx"),
    ).toEqual(["hooks", "mcpServers"]);
  });

  test("ignores the body, nested keys and files without frontmatter", () => {
    expect(
      riskyFrontmatterKeys("---\nname: a\nmeta:\n  hooks: 1\n---\nhooks: in the body"),
    ).toEqual([]);
    expect(riskyFrontmatterKeys("hooks: x")).toEqual([]);
  });
});
