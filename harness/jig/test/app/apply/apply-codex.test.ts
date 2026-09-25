import { describe, expect, test } from "bun:test";
import {
  type CodexApplyOptions,
  type CodexApplyPaths,
  applyCodex,
} from "../../../src/app/apply/apply-codex";
import type { CodexApplyPorts } from "../../../src/app/apply/ports";
import { MCP_BLOCK_BEGIN, MCP_BLOCK_END } from "../../../src/domain/codex/config";
import { type FakeClaudeFs, type FakeClaudeFsSeed, fakeClaudeFs } from "./fake-claude-ports";

const H = "/repo/llm/harness";
const OLD = "/repo/config/claude-profiles";
const CODEX = "/home/u/.codex";
const AGENTS_SKILLS = "/home/u/.agents/skills";

const PATHS: CodexApplyPaths = {
  harnessRoot: H,
  mcpServers: `${H}/mcp/servers.json`,
  decisions: `${H}/rules/decisions`,
  formerSkillRoots: [OLD],
  agentsSkills: AGENTS_SKILLS,
  codexSkills: `${CODEX}/skills`,
  agentsMd: `${CODEX}/AGENTS.md`,
  agentsDir: `${CODEX}/agents`,
  configToml: `${CODEX}/config.toml`,
  hooksJson: `${CODEX}/hooks.json`,
  home: "/home/u",
};

const OPTIONS: CodexApplyOptions = {
  codexModels: {},
  validateToml: (text) => {
    Bun.TOML.parse(text);
  },
};

/** The ruling of 2026-09-23, as `agents/models.json`'s codex table parses. */
const RULED_MODELS = {
  sonnet: { model: "gpt-6-luna", reasoningEffort: "high" },
  haiku: { model: "gpt-6-luna", reasoningEffort: "medium" },
  opus: { model: "gpt-6-sol", reasoningEffort: "medium" },
};

const MCP_SOURCE = JSON.stringify({
  schemaVersion: "jig.mcp.v1",
  servers: [
    {
      name: "serena",
      transport: "stdio",
      command: "uvx",
      args: ["serena", "--context", "claude-code"],
      targets: { claude: true, codex: true },
      targetOverrides: { codex: { args: ["serena", "--context", "codex"] } },
    },
    {
      name: "codebase-memory-mcp",
      transport: "stdio",
      command: "{{HOME}}/bin/cmm",
      args: [],
      targets: { claude: true, codex: true },
    },
    {
      name: "figma-remote",
      transport: "http",
      url: "https://mcp.figma.com/mcp",
      targets: { codex: true },
    },
    { name: "claude-only", transport: "stdio", command: "x", targets: { claude: true } },
  ],
});

const DECISION = "# 決定の題\n\nStatus: accepted — 理由（2026-09-22）\n\nrule: Do the one thing.\n";

const RESEARCH_AGENT =
  '---\nname: research\ndescription: Industry survey.\ntools: ["Read", "WebFetch"]\nmodel: sonnet\n---\n\nSurvey first, judge second.\n';
const SCOUT_AGENT =
  "---\nname: scout\ndescription: Cheap lookups.\ntools: [Read]\nmodel: haiku\n---\n\nLook things up.\n";

/** The sources every test starts from; the destination side is the seed. */
function fakePorts(seed: FakeClaudeFsSeed = {}): FakeClaudeFs {
  return fakeClaudeFs({
    ...seed,
    files: {
      [PATHS.mcpServers]: MCP_SOURCE,
      [`${PATHS.decisions}/2026-09-22-one.md`]: DECISION,
      [`${H}/rules/common/README.md`]: "# rules/common\n",
      [`${H}/rules/common/core.md`]: "# Core\n\nBe brief.\n",
      [`${H}/skills/README.md`]: "# skills\n",
      [`${H}/skills/writeup/SKILL.md`]: "---\nname: writeup\n---\n",
      [`${H}/skills/grilling/SKILL.md`]: "---\nname: grilling\n---\n",
      [`${H}/agents/research.md`]: RESEARCH_AGENT,
      [`${H}/agents/scout.md`]: SCOUT_AGENT,
      ...seed.files,
    },
  });
}

const run = (ports: CodexApplyPorts, write = false) =>
  applyCodex({ paths: PATHS, options: OPTIONS, write }, ports);

const LIVE_CONFIG_TOML = `sandbox_mode = "workspace-write"

# yoki:begin
default_permissions = "yoki"

[permissions.yoki]
extends = ":workspace"

[permissions.yoki.filesystem]
"~/.ssh/id_*" = "deny"

[mcp_servers.figma-remote]
url = "https://mcp.figma.com/mcp"
# yoki:end

[projects."/repo"]
trust_level = "trusted"

[mcp_servers.serena]
command = "uvx"
args = ["serena", "--context", "codex"]

# jig:begin hooks
[hooks.state."/home/u/.codex/hooks.json:pre_tool_use:0:0"]
trusted_hash = "sha256:abc"
enabled = true
# jig:end hooks

[sandbox_workspace_write]
network_access = false
`;

/** The machine as yoki-switch left it: dangling links into the old tree, cmd-* directories, its own files. */
const YOKI_SWITCH_MACHINE: FakeClaudeFsSeed = {
  files: {
    [PATHS.agentsMd]: "<!-- yoki:begin -->\n# Core Rules (yoki)\n",
    [`${PATHS.agentsDir}/research.toml`]: 'name = "research"\n',
    [`${PATHS.agentsDir}/css-perf-reviewer.toml`]: 'name = "css-perf-reviewer"\n',
    [`${PATHS.codexSkills}/cmd-aside/SKILL.md`]: "---\nname: cmd-aside\n---\n",
    [`${PATHS.codexSkills}/.system/imagegen/SKILL.md`]: "bundled",
    [PATHS.configToml]: LIVE_CONFIG_TOML,
    [PATHS.hooksJson]: '{"hooks":{}}',
  },
  links: {
    [`${AGENTS_SKILLS}/writeup`]: `${OLD}/core/skills/writeup`,
    [`${AGENTS_SKILLS}/grilling`]: `${OLD}/core/skills/grilling`,
    [`${AGENTS_SKILLS}/retired`]: `${OLD}/packs/go/skills/retired`,
    [`${PATHS.codexSkills}/grilling`]: `${OLD}/core/skills/grilling/codex`,
  },
};

describe("dry-run is the default", () => {
  test("nothing is written, the outcome is the plan, and hooks.json is only named", async () => {
    const { ports, files, links, manifest } = fakePorts();
    const report = await run(ports);

    expect(report.wrote).toBe(false);
    expect(report.outcome).toBe("write");
    expect(report.hooksJson).toBe(PATHS.hooksJson);
    expect(files[PATHS.agentsMd]).toBeUndefined();
    expect(files[PATHS.configToml]).toBeUndefined();
    expect(links).toEqual({});
    expect(manifest).toEqual({});
  });
});

describe("the skills mount, and ~/.codex/skills reported beside it", () => {
  test("~/.agents/skills gets every skill; ~/.codex/skills gets nothing planned", async () => {
    const { ports } = fakePorts();
    const report = await run(ports);

    expect(report.agentsSkillsDir.selection.linked).toEqual(["grilling", "writeup"]);
    expect(
      report.agentsSkillsDir.entries.map((e) => (e.kind === "link" ? e.plan.target : e.kind)),
    ).toEqual([`${H}/skills/grilling`, `${H}/skills/writeup`]);
    expect(report.codexSkills).toEqual({
      path: PATHS.codexSkills,
      state: { kind: "missing" },
      entries: [],
    });
  });

  test("on the machine yoki-switch left: links into the old tree are stale (replaced or removed); ~/.codex/skills is listed entry by entry with whose each is, and left alone", async () => {
    const { ports } = fakePorts(YOKI_SWITCH_MACHINE);
    const report = await run(ports);

    expect(
      report.agentsSkillsDir.entries.map((e) =>
        e.kind === "link"
          ? `${e.name}:${e.plan.state}`
          : `${e.name}:${e.kind}${e.kind === "stale" ? `:${e.reason}` : ""}`,
      ),
    ).toEqual(["grilling:replace", "writeup:replace", "retired:stale:former-tree"]);
    expect(report.codexSkills.state).toEqual({ kind: "dir" });
    expect(report.codexSkills.entries).toEqual([
      {
        name: ".system",
        path: `${PATHS.codexSkills}/.system`,
        what: "a directory",
        note: "Codex's bundled skills; Codex's own",
      },
      {
        name: "cmd-aside",
        path: `${PATHS.codexSkills}/cmd-aside`,
        what: "a directory",
        note: "yoki's command→skill conversion; commands are skills, delivered through ~/.agents/skills",
      },
      {
        name: "grilling",
        path: `${PATHS.codexSkills}/grilling`,
        what: `a symlink → ${OLD}/core/skills/grilling/codex`,
        note: "yoki's link to a codex/SKILL.md port; ports are dropped, the skill reaches Codex through ~/.agents/skills",
      },
    ]);
  });

  test("a dangling link that points nowhere jig knows is stale too; a live link elsewhere is not jig's", async () => {
    const { ports, links } = fakePorts({
      files: { "/elsewhere/mine/SKILL.md": "x" },
      links: {
        [`${AGENTS_SKILLS}/gone`]: "/nowhere/gone",
        [`${AGENTS_SKILLS}/mine`]: "/elsewhere/mine",
      },
    });
    const dry = await run(ports);
    expect(
      dry.agentsSkillsDir.entries
        .filter((e) => e.kind !== "link")
        .map((e) => `${e.name}:${e.kind}${e.kind === "stale" ? `:${e.reason}` : ""}`),
    ).toEqual(["gone:stale:dangling", "mine:foreign"]);

    await run(ports, true);
    expect(links[`${AGENTS_SKILLS}/gone`]).toBeUndefined();
    expect(links[`${AGENTS_SKILLS}/mine`]).toBe("/elsewhere/mine");
  });
});

describe("AGENTS.md", () => {
  test("is the same content the Claude target generates, and a yoki file there is kept aside on first write", async () => {
    const { ports, files, manifest } = fakePorts(YOKI_SWITCH_MACHINE);
    const dry = await run(ports);
    expect(dry.agentsMd.content).toContain("# Core\n\nBe brief.");
    expect(dry.agentsMd.content).toContain("- **Do the one thing.**");
    expect(dry.agentsMd.backupPath).toBe(`${PATHS.agentsMd}.pre-jig.20260923-000000`);
    expect(dry.agentsMd.diff).toContain("yoki:begin");

    // The first write is blocked by the config.toml conflicts; clear the file for this test.
    files[PATHS.configToml] = "[features]\nhooks = true\n";
    const report = await run(ports, true);
    expect(report.wrote).toBe(true);
    expect(files[PATHS.agentsMd]).toBe(report.agentsMd.content);
    expect(files[`${PATHS.agentsMd}.pre-jig.20260923-000000`]).toBe(
      "<!-- yoki:begin -->\n# Core Rules (yoki)\n",
    );
    expect(manifest[PATHS.agentsMd]).toBe(ports.sha256(report.agentsMd.content));
  });
});

describe("the generated agent files", () => {
  test("one <name>.toml per agents/*.md, valid TOML, tools folded in, model left out and reported per tier", async () => {
    const { ports } = fakePorts();
    const report = await run(ports);
    const { agents } = report;

    expect(agents.files.map((f) => `${f.name}:${f.outcome}`)).toEqual([
      "research.toml:write",
      "scout.toml:write",
    ]);
    const research = agents.files[0];
    const parsed = Bun.TOML.parse(research?.content ?? "") as Record<string, unknown>;
    expect(parsed.name).toBe("research");
    expect(parsed.description).toBe("Industry survey.");
    expect(parsed.model).toBeUndefined();
    expect(String(parsed.developer_instructions)).toBe(
      "Survey first, judge second.\n\nThe source definition limits this agent to these tools: Read, WebFetch. Codex has no per-agent tool list, so honour it as an instruction.",
    );
    expect(research?.model).toEqual({ kind: "unmapped", tier: "sonnet" });
    expect(agents.unmappedTiers).toEqual([
      { tier: "sonnet", count: 1 },
      { tier: "haiku", count: 1 },
    ]);
  });

  test("a mapped tier lands in `model` and `model_reasoning_effort`; an unmapped one is never guessed", async () => {
    const { ports } = fakePorts();
    const report = await applyCodex(
      {
        paths: PATHS,
        options: {
          ...OPTIONS,
          codexModels: { sonnet: { model: "gpt-6-luna", reasoningEffort: "high" } },
          modelsSource: `${H}/agents/models.json`,
        },
        write: false,
      },
      ports,
    );
    const [research, scout] = report.agents.files;
    expect(Bun.TOML.parse(research?.content ?? "")).toMatchObject({
      model: "gpt-6-luna",
      model_reasoning_effort: "high",
    });
    expect((Bun.TOML.parse(scout?.content ?? "") as { model?: string }).model).toBeUndefined();
    expect(report.agents.mappingSource).toBe(`${H}/agents/models.json`);
    expect(report.agents.mappedTiers).toEqual([
      { tier: "sonnet", model: "gpt-6-luna", reasoningEffort: "high", count: 1 },
    ]);
    expect(report.agents.unmappedTiers).toEqual([{ tier: "haiku", count: 1 }]);
  });

  test("with the ruled table every tier is mapped and the gap count is zero", async () => {
    const { ports } = fakePorts();
    const report = await applyCodex(
      { paths: PATHS, options: { ...OPTIONS, codexModels: RULED_MODELS }, write: false },
      ports,
    );
    expect(report.agents.unmappedTiers).toEqual([]);
    expect(report.agents.mappedTiers).toEqual([
      { tier: "sonnet", model: "gpt-6-luna", reasoningEffort: "high", count: 1 },
      { tier: "haiku", model: "gpt-6-luna", reasoningEffort: "medium", count: 1 },
    ]);
    expect(Bun.TOML.parse(report.agents.files[1]?.content ?? "")).toMatchObject({
      name: "scout",
      model: "gpt-6-luna",
      model_reasoning_effort: "medium",
    });
  });

  test("an agent's own models.codex wins over the table, and the report says so", async () => {
    const { ports } = fakePorts({
      files: {
        [`${H}/agents/research.md`]:
          "---\nname: research\ndescription: Industry survey.\nmodel: sonnet\nmodels:\n  codex:\n    model: gpt-6-sol\n    reasoningEffort: xhigh\n---\n\nSurvey first, judge second.\n",
      },
    });
    const report = await applyCodex(
      { paths: PATHS, options: { ...OPTIONS, codexModels: RULED_MODELS }, write: false },
      ports,
    );
    const research = report.agents.files[0];
    expect(research?.model).toEqual({
      kind: "mapped",
      tier: "sonnet",
      model: "gpt-6-sol",
      reasoningEffort: "xhigh",
      override: true,
    });
    expect(Bun.TOML.parse(research?.content ?? "")).toMatchObject({
      model: "gpt-6-sol",
      model_reasoning_effort: "xhigh",
    });
    // The override is the agent's, not the tier's: the tier line counts only table-decided agents.
    expect(report.agents.mappedTiers).toEqual([
      { tier: "haiku", model: "gpt-6-luna", reasoningEffort: "medium", count: 1 },
    ]);
    expect(report.agents.unmappedTiers).toEqual([]);
  });

  test("a bad effort — in the table or in an override — is an error naming the agent, never written", async () => {
    const { ports, files } = fakePorts();
    expect(
      applyCodex(
        {
          paths: PATHS,
          options: {
            ...OPTIONS,
            codexModels: { sonnet: { model: "gpt-6-luna", reasoningEffort: "hi" } },
          },
          write: true,
        },
        ports,
      ),
    ).rejects.toThrow(
      'jig apply --target codex: agents/research.md: reasoningEffort "hi" for tier "sonnet"',
    );
    files[`${H}/agents/scout.md`] =
      "---\nname: scout\nmodel: haiku\nmodels: { codex: { model: gpt-6-luna, reasoningEffort: MAX } }\n---\nx\n";
    expect(run(ports, true)).rejects.toThrow(
      'agents/scout.md: reasoningEffort "MAX" for the models.codex override',
    );
    expect(files[`${PATHS.agentsDir}/research.toml`]).toBeUndefined();
  });

  test("files there that no source produces are not jig's; yoki's same-named files are kept aside on first write", async () => {
    const { ports, files } = fakePorts(YOKI_SWITCH_MACHINE);
    files[PATHS.configToml] = "";
    const dry = await run(ports);
    expect(dry.agents.foreign).toEqual([
      { name: "css-perf-reviewer.toml", what: "a regular file" },
    ]);
    expect(dry.agents.files[0]).toMatchObject({
      name: "research.toml",
      outcome: "write",
      backupPath: `${PATHS.agentsDir}/research.toml.pre-jig.20260923-000000`,
    });

    await run(ports, true);
    expect(files[`${PATHS.agentsDir}/research.toml.pre-jig.20260923-000000`]).toBe(
      'name = "research"\n',
    );
    expect(files[`${PATHS.agentsDir}/research.toml`]).toBe(dry.agents.files[0]?.content);
    expect(files[`${PATHS.agentsDir}/css-perf-reviewer.toml`]).toBe('name = "css-perf-reviewer"\n');
  });

  test("a hand edit after jig wrote one is a conflict for the whole delivery", async () => {
    const { ports, files, links } = fakePorts();
    await run(ports, true);
    files[`${PATHS.agentsDir}/scout.toml`] =
      'name = "scout"\ndescription = "edited"\ndeveloper_instructions = "x"\n';
    delete links[`${AGENTS_SKILLS}/writeup`];

    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.wrote).toBe(false);
    expect(report.message).toContain("agents/scout.toml");
    expect(links[`${AGENTS_SKILLS}/writeup`]).toBeUndefined();
  });
});

describe("config.toml", () => {
  test("jig's block carries the codex-targeted servers with overrides and {{HOME}}; the rest of the file is byte-for-byte", async () => {
    const { ports, files } = fakePorts({
      files: {
        [PATHS.configToml]:
          '[features]\nhooks = true\n\n[projects."/r"]\ntrust_level = "trusted"\n',
      },
    });
    const dry = await run(ports);
    expect(dry.configToml.servers).toEqual(["serena", "codebase-memory-mcp", "figma-remote"]);
    expect(dry.configToml.declaredOutside).toEqual([]);
    expect(dry.configToml.yokiLeftovers).toEqual([]);
    expect(dry.configToml.outcome).toBe("write");

    await run(ports, true);
    const written = files[PATHS.configToml] ?? "";
    expect(
      written.startsWith(
        '[features]\nhooks = true\n\n[projects."/r"]\ntrust_level = "trusted"\n\n',
      ),
    ).toBe(true);
    expect(written).toContain(
      `${MCP_BLOCK_BEGIN}\n[mcp_servers.serena]\ncommand = "uvx"\nargs = ["serena", "--context", "codex"]\n`,
    );
    expect(written).toContain(
      '[mcp_servers.codebase-memory-mcp]\ncommand = "/home/u/bin/cmm"\nargs = []\n',
    );
    expect(written).toContain('[mcp_servers.figma-remote]\nurl = "https://mcp.figma.com/mcp"\n');
    expect(written.endsWith(`${MCP_BLOCK_END}\n`)).toBe(true);
    expect(written).not.toContain("claude-only");
    const parsed = Bun.TOML.parse(written) as {
      mcp_servers: Record<string, unknown>;
      features: unknown;
    };
    expect(Object.keys(parsed.mcp_servers)).toHaveLength(3);
    expect(parsed.features).toEqual({ hooks: true });
  });

  test("a server declared outside jig's block is a conflict naming the table and its line; nothing is written", async () => {
    const { ports, files, links } = fakePorts(YOKI_SWITCH_MACHINE);
    const report = await run(ports, true);

    expect(report.outcome).toBe("conflict");
    expect(report.wrote).toBe(false);
    expect(report.configToml.declaredOutside).toEqual([
      { name: "figma-remote", line: 12 },
      { name: "serena", line: 19 },
    ]);
    expect(report.message).toContain("[mcp_servers.figma-remote] outside jig's block (line 12)");
    expect(report.configToml.yokiLeftovers).toEqual([
      "# yoki:begin … # yoki:end block (12 lines)",
      "[permissions.yoki]",
      "[permissions.yoki.filesystem]",
    ]);
    expect(files[PATHS.configToml]).toBe(LIVE_CONFIG_TOML);
    expect(files[PATHS.agentsMd]).toBe("<!-- yoki:begin -->\n# Core Rules (yoki)\n");
    expect(links[`${AGENTS_SKILLS}/retired`]).toBe(`${OLD}/packs/go/skills/retired`);
  });

  test("the hooks block, projects and everything else survive a write; a second apply is a noop", async () => {
    const { ports, files } = fakePorts(YOKI_SWITCH_MACHINE);
    // Reconcile by hand, as the dry-run says: drop the two foreign tables.
    files[PATHS.configToml] = LIVE_CONFIG_TOML.replace(
      '[mcp_servers.figma-remote]\nurl = "https://mcp.figma.com/mcp"\n',
      "",
    ).replace(
      '[mcp_servers.serena]\ncommand = "uvx"\nargs = ["serena", "--context", "codex"]\n\n',
      "",
    );
    const first = await run(ports, true);
    expect(first.wrote).toBe(true);
    const written = files[PATHS.configToml] ?? "";
    expect(written).toContain(
      '# jig:begin hooks\n[hooks.state."/home/u/.codex/hooks.json:pre_tool_use:0:0"]',
    );
    expect(written).toContain('[projects."/repo"]\ntrust_level = "trusted"');
    expect(written).toContain("[sandbox_workspace_write]\nnetwork_access = false");
    expect(written).toContain('[permissions.yoki.filesystem]\n"~/.ssh/id_*" = "deny"');

    const second = await run(ports, true);
    expect(second.outcome).toBe("noop");
    expect(second.configToml.outcome).toBe("noop");
    expect(second.agentsMd.outcome).toBe("noop");
    expect(second.agents.files.every((f) => f.outcome === "noop")).toBe(true);
    expect(
      second.agentsSkillsDir.entries.every((e) => e.kind === "link" && e.plan.state === "ok"),
    ).toBe(true);
  });

  test("Codex trusting a new directory after jig wrote is not a conflict: the block is what is compared", async () => {
    const { ports, files } = fakePorts({
      files: { [PATHS.configToml]: "[features]\nhooks = true\n" },
    });
    await run(ports, true);
    files[PATHS.configToml] =
      `${files[PATHS.configToml]}\n[projects."/new"]\ntrust_level = "trusted"\n`;

    const report = await run(ports, true);
    expect(report.outcome).toBe("noop");
    expect(files[PATHS.configToml]).toContain('[projects."/new"]');
  });

  test("a hand edit inside jig's block is a conflict", async () => {
    const { ports, files } = fakePorts({ files: { [PATHS.configToml]: "" } });
    await run(ports, true);
    files[PATHS.configToml] = (files[PATHS.configToml] ?? "").replace(
      'command = "uvx"',
      'command = "mine"',
    );

    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.message).toContain("config.toml's jig MCP block");
  });
});

describe("--write delivers everything in one run", () => {
  test("links, files, block, manifest and provenance", async () => {
    const { ports, files, links, dirs, manifest, provenance } = fakePorts(YOKI_SWITCH_MACHINE);
    files[PATHS.configToml] = "[features]\nhooks = true\n";
    const report = await run(ports, true);

    expect(report.wrote).toBe(true);
    expect(links[`${AGENTS_SKILLS}/writeup`]).toBe(`${H}/skills/writeup`);
    expect(links[`${AGENTS_SKILLS}/grilling`]).toBe(`${H}/skills/grilling`);
    expect(links[`${AGENTS_SKILLS}/retired`]).toBeUndefined();
    // ~/.codex/skills is not jig's: yoki's port link, its cmd-* directory and Codex's .system all stand.
    expect(links[`${PATHS.codexSkills}/grilling`]).toBe(`${OLD}/core/skills/grilling/codex`);
    expect(dirs.has(PATHS.codexSkills)).toBe(false);
    expect(files[`${PATHS.codexSkills}/cmd-aside/SKILL.md`]).toBe("---\nname: cmd-aside\n---\n");
    expect(files[`${PATHS.codexSkills}/.system/imagegen/SKILL.md`]).toBe("bundled");
    expect(files[`${PATHS.agentsDir}/scout.toml`]).toContain('name = "scout"');
    expect(files[PATHS.hooksJson]).toBe('{"hooks":{}}');
    expect(manifest[PATHS.configToml]).toBe(ports.sha256(report.configToml.block));
    expect(manifest[`${PATHS.agentsDir}/scout.toml`]).toBeDefined();
    expect(provenance[CODEX]?.sourceFile).toBe(PATHS.mcpServers);
  });
});

describe("a missing source is an error, not an empty result", () => {
  test("no MCP source", async () => {
    const { ports, files } = fakePorts();
    delete files[PATHS.mcpServers];
    expect(run(ports)).rejects.toThrow("MCP source not found");
  });
});
