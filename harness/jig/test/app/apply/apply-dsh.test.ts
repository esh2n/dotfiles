import { describe, expect, test } from "bun:test";
import { type DshApplyPaths, applyDsh } from "../../../src/app/apply/apply-dsh";
import type { DshApplyPorts } from "../../../src/app/apply/ports";
import { MCP_BLOCK_BEGIN, MCP_BLOCK_END } from "../../../src/domain/dsh/mcp";
import { type FakeClaudeFs, type FakeClaudeFsSeed, fakeClaudeFs } from "./fake-claude-ports";

const H = "/repo/llm/harness";
const REPO_DSH = "/repo/config/dsh";
const DSH = "/home/u/.dsh";
const PROFILES = `${DSH}/profiles`;

const PATHS: DshApplyPaths = {
  harnessRoot: H,
  mcpServers: `${H}/mcp/servers.json`,
  decisions: `${H}/rules/decisions`,
  dshHome: DSH,
  dshHomeVia: "default",
  profilesDir: PROFILES,
  repoProfilesDir: `${REPO_DSH}/profiles`,
  agentsMd: `${DSH}/AGENTS.md`,
  homePatch: `${DSH}/cordis.patch.yml`,
  agentsSkills: "/home/u/.agents/skills",
  agentsSkillsVia: "default",
  settingsYaml: `${DSH}/settings.yaml`,
  hooksClaudeJson: `${DSH}/hooks.claude.json`,
  pluginDir: `${H}/jig/adapters/dsh`,
  home: "/home/u",
};

const MCP_SOURCE = JSON.stringify({
  schemaVersion: "jig.mcp.v1",
  servers: [
    {
      name: "serena",
      transport: "stdio",
      command: "uvx",
      args: ["serena", "--context", "claude-code"],
      targets: { claude: true, dsh: true },
      targetOverrides: { dsh: { args: ["serena", "--context", "codex"] } },
    },
    {
      name: "codebase-memory-mcp",
      transport: "stdio",
      command: "{{HOME}}/bin/cmm",
      args: [],
      targets: { claude: true, dsh: true },
    },
    {
      name: "playwright",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp"],
      targets: { codex: true, dsh: false },
    },
  ],
});

const DECISION = "# A\n\nStatus: accepted — because\n\nrule: Do the thing.\n\n## Problem\n\nx\n";

const REPO_PATCH = `# User patch layer for the profile.
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: local-proxy
    model: main
- insert:
    - id: jig-guard
      name: '@esh2n/jig-dsh-guard'
      config:
        timeoutMs: 10000
`;

const SCAFFOLD = "# Your patch layer for this dsh profile.\n[]\n";

/** The sources every test starts from: the repo owns two profiles; the destination side is the seed. */
function fakePorts(seed: FakeClaudeFsSeed = {}): FakeClaudeFs {
  return fakeClaudeFs({
    ...seed,
    files: {
      [PATHS.mcpServers]: MCP_SOURCE,
      [`${H}/rules/common/core.md`]: "# Core\n\nBe brief.\n",
      [`${H}/rules/decisions/a.md`]: DECISION,
      [`${REPO_DSH}/profiles/proxy/cordis.patch.yml`]: REPO_PATCH,
      [`${REPO_DSH}/profiles/headless/cordis.patch.yml`]: REPO_PATCH,
      [`${REPO_DSH}/profiles/README.md`]: "# profiles\n",
      ...seed.files,
    },
  });
}

const run = (ports: DshApplyPorts, write = false) => applyDsh({ paths: PATHS, write }, ports);

/** The machine manager.sh left: both profiles scaffolded by dsh with the repo's patch installed, the plugin linked, dsh's own files beside. */
const MANAGER_SH_MACHINE: FakeClaudeFsSeed = {
  files: {
    [`${PROFILES}/proxy/cordis.patch.yml`]: REPO_PATCH,
    [`${PROFILES}/proxy/package.json`]: "{}",
    [`${PROFILES}/proxy/cordis.yml`]: "[]\n",
    [`${PROFILES}/headless/cordis.patch.yml`]: REPO_PATCH,
    [`${PROFILES}/headless/package.json`]: "{}",
    [`${PROFILES}/node_modules/@deepseek-ai/dsh/package.json`]: "{}",
    [`${DSH}/hooks.claude.json`]: "{}",
    [`${DSH}/sessions/x.jsonl`]: "",
  },
  links: {
    [`${PROFILES}/proxy/node_modules/@esh2n/jig-dsh-guard`]: `${H}/jig/adapters/dsh`,
    [`${DSH}/settings.yaml`]: `${REPO_DSH}/settings.yaml`,
  },
};

describe("dry-run is the default", () => {
  test("nothing is written, the outcome is the plan", async () => {
    const { ports, files, manifest } = fakePorts(MANAGER_SH_MACHINE);
    const report = await run(ports);

    expect(report.wrote).toBe(false);
    expect(report.outcome).toBe("write");
    expect(report.scaffolded).toBe(true);
    expect(files[`${PROFILES}/proxy/cordis.patch.yml`]).toBe(REPO_PATCH);
    expect(files[`${DSH}/AGENTS.md`]).toBeUndefined();
    expect(manifest).toEqual({});
  });
});

describe("profiles: scaffolded AND the repo's", () => {
  test("both are found, in name order; node_modules is not a profile; the plugin link is reported per profile", async () => {
    const { ports } = fakePorts(MANAGER_SH_MACHINE);
    const report = await run(ports);
    expect(report.profiles.map((p) => `${p.name}:${p.outcome}`)).toEqual([
      "headless:write",
      "proxy:write",
    ]);
    expect(report.notScaffolded).toEqual([]);
    expect(report.foreignProfiles).toEqual([]);
    expect(report.profiles[0]?.guardPlugin).toEqual({ kind: "missing" });
    expect(report.profiles[1]?.guardPlugin).toEqual({
      kind: "symlink",
      target: `${H}/jig/adapters/dsh`,
    });
    expect(report.profiles[1]?.sourcePatch).toBe(`${REPO_DSH}/profiles/proxy/cordis.patch.yml`);
  });

  test("a repo profile dsh has not scaffolded gets nothing and no directory; a scaffolded profile the repo does not own is not jig's", async () => {
    const { ports, dirs, files } = fakePorts({
      files: {
        [`${PROFILES}/proxy/cordis.patch.yml`]: SCAFFOLD,
        [`${PROFILES}/web/cordis.patch.yml`]: SCAFFOLD,
      },
    });
    const report = await run(ports, true);
    expect(report.profiles.map((p) => p.name)).toEqual(["proxy"]);
    expect(report.notScaffolded).toEqual(["headless"]);
    expect(report.foreignProfiles).toEqual(["web"]);
    expect(dirs.has(`${PROFILES}/headless`)).toBe(false);
    expect(files[`${PROFILES}/headless/cordis.patch.yml`]).toBeUndefined();
    expect(files[`${PROFILES}/web/cordis.patch.yml`]).toBe(SCAFFOLD);
  });

  test("DSH not scaffolded: no matching profile means nothing is delivered — not even AGENTS.md — and --write writes nothing", async () => {
    const { ports, files, dirs, manifest, provenance } = fakePorts();
    const report = await run(ports, true);
    expect(report.scaffolded).toBe(false);
    expect(report.outcome).toBe("noop");
    expect(report.wrote).toBe(false);
    expect(report.message).toContain("DSH not scaffolded");
    expect(report.message).toContain("headless, proxy");
    expect(report.agentsMd).toBeUndefined();
    expect(report.notScaffolded).toEqual(["headless", "proxy"]);
    expect(Object.keys(files).some((path) => path.startsWith(DSH))).toBe(false);
    expect(dirs.size).toBe(0);
    expect(manifest).toEqual({});
    expect(provenance).toEqual({});
  });

  test("a profiles directory with only foreign profiles is not scaffolded for jig's purposes either", async () => {
    const { ports, files } = fakePorts({
      files: { [`${PROFILES}/web/cordis.patch.yml`]: SCAFFOLD },
    });
    const report = await run(ports, true);
    expect(report.scaffolded).toBe(false);
    expect(report.foreignProfiles).toEqual(["web"]);
    expect(files[`${DSH}/AGENTS.md`]).toBeUndefined();
  });
});

describe("the MCP rows in cordis.patch.yml", () => {
  test("only targets.dsh servers, override applied, {{HOME}} expanded; the block is appended after the repo's rows, which are carried through byte for byte", async () => {
    const { ports, files } = fakePorts(MANAGER_SH_MACHINE);
    const dry = await run(ports);
    expect(dry.mcp.rows.map((row) => row.id)).toEqual(["mcp-serena", "mcp-codebase-memory-mcp"]);
    expect(dry.mcp.block).not.toContain("playwright");
    expect(dry.profiles[0]?.replacesEmptyLayer).toBe(false);
    expect(dry.profiles[0]?.diff).toContain("+# jig:begin mcp");

    await run(ports, true);
    const written = files[`${PROFILES}/proxy/cordis.patch.yml`] ?? "";
    expect(written.startsWith(REPO_PATCH)).toBe(true);
    expect(written.endsWith(`${MCP_BLOCK_END}\n`)).toBe(true);
    const parsed = Bun.YAML.parse(written) as Record<string, unknown>[];
    expect(parsed.map((row) => Object.keys(row)[0])).toEqual(["id", "insert", "insert"]);
    const inserted = (parsed[2] as { insert: { id: string; config: Record<string, unknown> }[] })
      .insert;
    expect(inserted.map((e) => e.id)).toEqual(["mcp-serena", "mcp-codebase-memory-mcp"]);
    expect(inserted[0]?.config).toEqual({
      serverName: "serena",
      transport: "stdio",
      command: "uvx",
      args: ["serena", "--context", "codex"],
    });
    expect(inserted[1]?.config).toEqual({
      serverName: "codebase-memory-mcp",
      transport: "stdio",
      command: "/home/u/bin/cmm",
    });
    expect(files[`${PROFILES}/headless/cordis.patch.yml`]).toBe(written);
  });

  test("the scaffold's lone `[]` gives way to the block; an absent file gets the block alone", async () => {
    const { ports, files } = fakePorts({
      files: {
        [`${PROFILES}/proxy/cordis.patch.yml`]: SCAFFOLD,
        [`${PROFILES}/headless/package.json`]: "{}",
      },
    });
    const dry = await run(ports);
    expect(dry.profiles.find((p) => p.name === "proxy")?.replacesEmptyLayer).toBe(true);
    expect(dry.profiles.find((p) => p.name === "headless")?.state).toEqual({ kind: "missing" });

    await run(ports, true);
    const proxy = files[`${PROFILES}/proxy/cordis.patch.yml`] ?? "";
    expect(proxy).toContain("# Your patch layer for this dsh profile.");
    expect(proxy).not.toContain("[]");
    expect(Bun.YAML.parse(proxy)).toHaveLength(1);
    expect((files[`${PROFILES}/headless/cordis.patch.yml`] ?? "").startsWith(MCP_BLOCK_BEGIN)).toBe(
      true,
    );
  });

  test("a hand edit inside the block is a conflict and nothing is written; a hand-added row outside it is not", async () => {
    const { ports, files } = fakePorts(MANAGER_SH_MACHINE);
    await run(ports, true);
    const path = `${PROFILES}/proxy/cordis.patch.yml`;
    const written = files[path] ?? "";

    // A row added by hand after jig's block: carried through, no conflict.
    files[path] = `${written}- insert:\n    - id: mine\n      name: '@x/mine'\n`;
    const added = await run(ports, true);
    expect(added.outcome).toBe("noop");
    expect(files[path]).toContain("id: mine");

    files[path] = written.replace("command: 'uvx'", "command: 'uvx'\n        cwd: '/tmp'");
    const edited = await run(ports, true);
    expect(edited.outcome).toBe("conflict");
    expect(edited.wrote).toBe(false);
    expect(edited.message).toContain("hand edit inside the block");
    expect(files[path]).toContain("cwd: '/tmp'");
    expect(files[`${PROFILES}/headless/cordis.patch.yml`]).toBe(written);
  });

  test("a jig id or server name declared outside the block is a conflict naming the line, in a profile or in the home-level layer", async () => {
    const byHand = `${REPO_PATCH}- insert:\n    - id: mcp-serena\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: serena\n`;
    const { ports, files } = fakePorts({
      files: {
        [`${PROFILES}/proxy/cordis.patch.yml`]: byHand,
        [`${PROFILES}/headless/cordis.patch.yml`]: REPO_PATCH,
      },
    });
    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.profiles.find((p) => p.name === "proxy")?.declaredOutside).toEqual([
      { kind: "id", value: "mcp-serena", line: 13 },
      { kind: "serverName", value: "serena", line: 16 },
    ]);
    expect(report.message).toContain("id mcp-serena (line 13)");
    expect(files[`${PROFILES}/headless/cordis.patch.yml`]).toBe(REPO_PATCH);

    const home = fakePorts({
      files: {
        [`${PROFILES}/proxy/cordis.patch.yml`]: REPO_PATCH,
        [`${DSH}/cordis.patch.yml`]:
          "- insert:\n    - id: x\n      config:\n        serverName: 'codebase-memory-mcp'\n",
      },
    });
    const homeReport = await run(home.ports, true);
    expect(homeReport.outcome).toBe("conflict");
    expect(homeReport.homePatch.declaredOutside).toEqual([
      { kind: "serverName", value: "codebase-memory-mcp", line: 4 },
    ]);
    expect(homeReport.message).toContain("home-level layer");
    expect(home.files[`${PROFILES}/proxy/cordis.patch.yml`]).toBe(REPO_PATCH);
    expect(home.files[`${DSH}/cordis.patch.yml`]).toContain("id: x");
  });

  test("an unterminated block is a conflict; the home-level layer is never written", async () => {
    const { ports, files } = fakePorts({
      files: {
        [`${PROFILES}/proxy/cordis.patch.yml`]: `${REPO_PATCH}${MCP_BLOCK_BEGIN}\n- insert: []\n`,
        [`${DSH}/cordis.patch.yml`]: "[]\n",
      },
    });
    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.profiles[0]?.invalid).toContain("without");
    expect(report.homePatch.state).toEqual({ kind: "file" });
    expect(files[`${DSH}/cordis.patch.yml`]).toBe("[]\n");
  });

  test("manager.sh overwriting the file with the repo copy reads as write again, never as a conflict", async () => {
    const { ports, files } = fakePorts(MANAGER_SH_MACHINE);
    await run(ports, true);
    files[`${PROFILES}/proxy/cordis.patch.yml`] = REPO_PATCH;
    const report = await run(ports);
    expect(report.outcome).toBe("write");
    expect(report.profiles.map((p) => `${p.name}:${p.outcome}`)).toEqual([
      "headless:noop",
      "proxy:write",
    ]);
  });
});

describe("AGENTS.md in the harness home", () => {
  test("the generated file, with the size for the budget line; a file jig never wrote is kept aside; a hand edit after is a conflict", async () => {
    const { ports, files } = fakePorts({
      ...MANAGER_SH_MACHINE,
      files: { ...MANAGER_SH_MACHINE.files, [`${DSH}/AGENTS.md`]: "mine\n" },
    });
    const dry = await run(ports);
    expect(dry.agentsMd?.outcome).toBe("write");
    expect(dry.agentsMd?.content).toContain("# Core");
    expect(dry.agentsMd?.content).toContain("**Do the thing.**");
    expect(dry.agentsMd?.bytes).toBeGreaterThan(0);
    expect(dry.agentsMd?.backupPath).toBe(`${DSH}/AGENTS.md.pre-jig.20260923-000000`);

    await run(ports, true);
    expect(files[`${DSH}/AGENTS.md.pre-jig.20260923-000000`]).toBe("mine\n");
    expect(files[`${DSH}/AGENTS.md`]).toBe(dry.agentsMd?.content ?? "");

    files[`${DSH}/AGENTS.md`] = "edited by hand\n";
    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.wrote).toBe(false);
    expect(report.message).toContain("AGENTS.md");
    expect(files[`${DSH}/AGENTS.md`]).toBe("edited by hand\n");
  });
});

describe("report only", () => {
  test("the skills mount, settings.yaml and hooks.claude.json are inspected and never touched", async () => {
    const { ports, links, files } = fakePorts(MANAGER_SH_MACHINE);
    const report = await run(ports, true);
    expect(report.agentsSkills).toEqual({
      path: "/home/u/.agents/skills",
      state: { kind: "missing" },
    });
    expect(report.settingsYaml).toEqual({
      path: `${DSH}/settings.yaml`,
      state: { kind: "symlink", target: `${REPO_DSH}/settings.yaml` },
    });
    expect(report.hooksClaudeJson).toEqual({
      path: `${DSH}/hooks.claude.json`,
      state: { kind: "file" },
    });
    expect(links[`${DSH}/settings.yaml`]).toBe(`${REPO_DSH}/settings.yaml`);
    expect(files[`${DSH}/hooks.claude.json`]).toBe("{}");
    expect(links["/home/u/.agents/skills"]).toBeUndefined();
  });
});

describe("--write delivers everything in one run", () => {
  test("both profiles, AGENTS.md, manifest and provenance; dsh's own files untouched; then a second apply is a noop", async () => {
    const { ports, files, manifest, provenance } = fakePorts(MANAGER_SH_MACHINE);
    const first = await run(ports, true);

    expect(first.wrote).toBe(true);
    expect(files[`${PROFILES}/proxy/cordis.patch.yml`]).toContain(MCP_BLOCK_BEGIN);
    expect(files[`${PROFILES}/headless/cordis.patch.yml`]).toContain(MCP_BLOCK_BEGIN);
    expect(files[`${DSH}/AGENTS.md`]).toContain("# Core");
    expect(manifest[`${PROFILES}/proxy/cordis.patch.yml`]).toBe(ports.sha256(first.mcp.block));
    expect(manifest[`${PROFILES}/headless/cordis.patch.yml`]).toBe(ports.sha256(first.mcp.block));
    expect(manifest[`${DSH}/AGENTS.md`]).toBeDefined();
    expect(provenance[DSH]?.sourceFile).toBe(PATHS.mcpServers);
    expect(files[`${PROFILES}/proxy/package.json`]).toBe("{}");
    expect(files[`${PROFILES}/proxy/cordis.yml`]).toBe("[]\n");
    expect(files[`${DSH}/sessions/x.jsonl`]).toBe("");

    const second = await run(ports, true);
    expect(second.outcome).toBe("noop");
    expect(second.profiles.every((p) => p.outcome === "noop")).toBe(true);
    expect(second.agentsMd?.outcome).toBe("noop");
  });

  test("a file already holding exactly the block is seeded into the manifest on --write, so a later hand edit is caught", async () => {
    const seeded = fakePorts(MANAGER_SH_MACHINE);
    const first = await run(seeded.ports, true);
    const current = seeded.files[`${PROFILES}/proxy/cordis.patch.yml`] ?? "";

    const { ports, files, manifest } = fakePorts({
      files: {
        [`${PROFILES}/proxy/cordis.patch.yml`]: current,
        [`${PROFILES}/headless/cordis.patch.yml`]: current,
        [`${DSH}/AGENTS.md`]: first.agentsMd?.content ?? "",
      },
    });
    const report = await run(ports, true);
    expect(report.outcome).toBe("noop");
    expect(report.wrote).toBe(false);
    expect(manifest[`${PROFILES}/proxy/cordis.patch.yml`]).toBe(ports.sha256(first.mcp.block));
    expect(manifest[`${DSH}/AGENTS.md`]).toBeDefined();

    files[`${PROFILES}/proxy/cordis.patch.yml`] = current.replace("'uvx'", "'uvx2'");
    expect((await run(ports, true)).outcome).toBe("conflict");
  });
});

describe("a missing source is an error, not an empty result", () => {
  test("no MCP source", async () => {
    const { ports, files } = fakePorts(MANAGER_SH_MACHINE);
    delete files[PATHS.mcpServers];
    expect(run(ports)).rejects.toThrow("MCP source not found");
  });
});
