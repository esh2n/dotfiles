import { describe, expect, test } from "bun:test";
import { type PiApplyPaths, applyPi } from "../../../src/app/apply/apply-pi";
import type { PiApplyPorts } from "../../../src/app/apply/ports";
import { type FakeClaudeFs, type FakeClaudeFsSeed, fakeClaudeFs } from "./fake-claude-ports";

const H = "/repo/llm/harness";
const OLD = "/repo/config/claude-profiles";
const REPO_PI = "/repo/config/pi";
const PI = "/home/u/.pi/agent";
const AGENTS_SKILLS = "/home/u/.agents/skills";
const MCP_JSON = "/home/u/.config/mcp/mcp.json";

const PATHS: PiApplyPaths = {
  harnessRoot: H,
  mcpServers: `${H}/mcp/servers.json`,
  decisions: `${H}/rules/decisions`,
  formerSkillRoots: [OLD],
  agentsSkills: AGENTS_SKILLS,
  agentDir: PI,
  agentsMd: `${PI}/AGENTS.md`,
  mcpJson: MCP_JSON,
  adapterOverride: `${PI}/mcp.json`,
  extensionsDir: `${PI}/extensions`,
  repoExtensionsDir: `${REPO_PI}/extensions`,
  repoSettings: `${REPO_PI}/settings.json`,
  retiredAgentsMd: `${REPO_PI}/AGENTS.md`,
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
      targets: { claude: true, pi: true },
      targetOverrides: { pi: { args: ["serena", "--context", "codex"] } },
    },
    {
      name: "codebase-memory-mcp",
      transport: "stdio",
      command: "{{HOME}}/bin/cmm",
      args: [],
      targets: { claude: true, pi: true },
    },
    {
      name: "figma-remote",
      transport: "http",
      url: "https://mcp.figma.com/mcp",
      targets: { pi: true },
    },
    { name: "claude-only", transport: "stdio", command: "x", targets: { claude: true } },
  ],
});

const DECISION = "# A\n\nStatus: accepted — because\n\nrule: Do the thing.\n\n## Problem\n\nx\n";

const REPO_SETTINGS = JSON.stringify({
  defaultProvider: "proxy",
  packages: ["https://github.com/dimk90/pi-context-view", "npm:pi-web-access"],
});

/** The sources every test starts from; the destination side is the seed. */
function fakePorts(seed: FakeClaudeFsSeed = {}): FakeClaudeFs {
  return fakeClaudeFs({
    ...seed,
    files: {
      [PATHS.mcpServers]: MCP_SOURCE,
      [`${H}/rules/common/core.md`]: "# Core\n\nBe brief.\n",
      [`${H}/rules/decisions/a.md`]: DECISION,
      [`${H}/skills/README.md`]: "# skills\n",
      [`${H}/skills/writeup/SKILL.md`]: "---\nname: writeup\n---\n",
      [`${H}/skills/grilling/SKILL.md`]: "---\nname: grilling\n---\n",
      [PATHS.repoSettings]: REPO_SETTINGS,
      ...seed.files,
    },
  });
}

const run = (ports: PiApplyPorts, write = false) => applyPi({ paths: PATHS, write }, ports);

const SHORT_PI_AGENTS_MD = "# Working rules (all pi tiers)\n\nKeep it short.\n";

/** The machine manager.sh left: file symlinks into the repo, the adapter not installed, orca's own extensions. */
const MANAGER_SH_MACHINE: FakeClaudeFsSeed = {
  files: {
    [`${REPO_PI}/AGENTS.md`]: SHORT_PI_AGENTS_MD,
    [`${REPO_PI}/extensions/guard.ts`]: "export default function () {}\n",
    [`${REPO_PI}/extensions/gate.ts`]: "export default function () {}\n",
    [`${PI}/extensions/orca-prefill.ts`]: "export default function () {}\n",
    [`${PI}/models-store.json`]: "{}",
  },
  links: {
    [`${PI}/AGENTS.md`]: `${REPO_PI}/AGENTS.md`,
    [`${PI}/settings.json`]: `${REPO_PI}/settings.json`,
    [`${PI}/extensions/guard.ts`]: `${REPO_PI}/extensions/guard.ts`,
    [`${PI}/extensions/gate.ts`]: `${REPO_PI}/extensions/gate.ts`,
    [`${AGENTS_SKILLS}/writeup`]: `${OLD}/core/skills/writeup`,
    [`${AGENTS_SKILLS}/retired`]: `${OLD}/packs/go/skills/retired`,
  },
};

describe("dry-run is the default", () => {
  test("nothing is written, the outcome is the plan", async () => {
    const { ports, files, links, manifest } = fakePorts(MANAGER_SH_MACHINE);
    const report = await run(ports);

    expect(report.wrote).toBe(false);
    expect(report.outcome).toBe("write");
    expect(files[MCP_JSON]).toBeUndefined();
    expect(links[`${PI}/AGENTS.md`]).toBe(`${REPO_PI}/AGENTS.md`);
    expect(files[`${REPO_PI}/AGENTS.md`]).toBe(SHORT_PI_AGENTS_MD);
    expect(manifest).toEqual({});
  });
});

describe("the cross-harness skills mount", () => {
  test("is the same plan the codex and omp targets make, and says this run was pi's", async () => {
    const { ports } = fakePorts(MANAGER_SH_MACHINE);
    const report = await run(ports);

    expect(report.agentsSkillsDir.target).toBe("pi");
    expect(report.agentsSkillsDir.selection.linked).toEqual(["grilling", "writeup"]);
    expect(
      report.agentsSkillsDir.entries.map((e) =>
        e.kind === "link"
          ? `${e.name}:${e.plan.state}`
          : `${e.name}:${e.kind}${e.kind === "stale" ? `:${e.reason}` : ""}`,
      ),
    ).toEqual(["grilling:create", "writeup:replace", "retired:stale:former-tree"]);
  });

  test("no <agentDir>/skills is created", async () => {
    const { ports, dirs, links } = fakePorts();
    await run(ports, true);
    expect(dirs.has(`${PI}/skills`)).toBe(false);
    expect(Object.keys(links).some((path) => path.startsWith(`${PI}/skills`))).toBe(false);
  });
});

describe("AGENTS.md over the symlink", () => {
  test("the link is replaced by the generated file: no backup, the repo file untouched and reported as the retiring source", async () => {
    const { ports, files, links, manifest } = fakePorts(MANAGER_SH_MACHINE);
    const dry = await run(ports);
    expect(dry.agentsMd.outcome).toBe("write");
    expect(dry.agentsMd.replacesSymlink).toBe(`${REPO_PI}/AGENTS.md`);
    expect(dry.agentsMd.backupPath).toBeUndefined();
    expect(dry.agentsMd.content).toContain("# Core");
    expect(dry.agentsMd.content).toContain("**Do the thing.**");
    expect(dry.agentsMd.diff).toContain("-# Working rules (all pi tiers)");
    expect(dry.retiredAgentsMd).toEqual({ path: `${REPO_PI}/AGENTS.md`, state: { kind: "file" } });

    const report = await run(ports, true);
    expect(report.wrote).toBe(true);
    expect(links[`${PI}/AGENTS.md`]).toBeUndefined();
    expect(files[`${PI}/AGENTS.md`]).toBe(dry.agentsMd.content);
    expect(files[`${REPO_PI}/AGENTS.md`]).toBe(SHORT_PI_AGENTS_MD);
    expect(Object.keys(files).some((path) => path.includes("AGENTS.md.pre-jig"))).toBe(false);
    expect(manifest[`${PI}/AGENTS.md`]).toBe(ports.sha256(dry.agentsMd.content));
  });

  test("a regular file jig never wrote is kept aside; a hand edit after jig wrote is a conflict", async () => {
    const { ports, files } = fakePorts({ files: { [`${PI}/AGENTS.md`]: "mine\n" } });
    const dry = await run(ports);
    expect(dry.agentsMd.backupPath).toBe(`${PI}/AGENTS.md.pre-jig.20260923-000000`);
    await run(ports, true);
    expect(files[`${PI}/AGENTS.md.pre-jig.20260923-000000`]).toBe("mine\n");

    files[`${PI}/AGENTS.md`] = "edited by hand\n";
    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.wrote).toBe(false);
    expect(report.message).toContain("AGENTS.md");
    expect(files[`${PI}/AGENTS.md`]).toBe("edited by hand\n");
  });
});

describe("pi-mcp-adapter's config", () => {
  test("jig's entries with overrides and {{HOME}}, no type; a hand-added server and the adapter's settings carried through", async () => {
    const { ports, files } = fakePorts({
      files: {
        [MCP_JSON]: JSON.stringify({
          settings: { hostConfigDiscovery: "off" },
          mcpServers: { mine: { url: "https://mine.example/mcp", lifecycle: "keep-alive" } },
        }),
      },
    });
    const dry = await run(ports);
    expect(dry.mcpJson.servers).toEqual(["serena", "codebase-memory-mcp", "figma-remote"]);
    expect(dry.mcpJson.foreign).toEqual(["mine"]);
    expect(dry.mcpJson.carried).toEqual(["settings"]);
    expect(dry.mcpJson.outcome).toBe("write");
    expect(dry.mcpJson.adapterOverride).toEqual({
      path: `${PI}/mcp.json`,
      state: { kind: "missing" },
    });

    await run(ports, true);
    const written = JSON.parse(files[MCP_JSON] ?? "") as {
      settings: Record<string, unknown>;
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(written)).toEqual(["mcpServers", "settings"]);
    expect(Object.keys(written.mcpServers)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
      "mine",
    ]);
    expect(written.mcpServers.serena).toEqual({
      command: "uvx",
      args: ["serena", "--context", "codex"],
    });
    expect(written.mcpServers["codebase-memory-mcp"]).toEqual({ command: "/home/u/bin/cmm" });
    expect(written.mcpServers["figma-remote"]).toEqual({ url: "https://mcp.figma.com/mcp" });
    expect(written.mcpServers.mine).toEqual({
      url: "https://mine.example/mcp",
      lifecycle: "keep-alive",
    });
    expect(written.settings).toEqual({ hostConfigDiscovery: "off" });
    expect(files[MCP_JSON]).not.toContain("claude-only");
    expect(files[MCP_JSON]).not.toContain('"type"');
  });

  test("the adapter's own override file is reported as found and never written", async () => {
    const { ports, files } = fakePorts({ files: { [`${PI}/mcp.json`]: '{"mcpServers":{}}' } });
    const report = await run(ports, true);
    expect(report.mcpJson.adapterOverride.state).toEqual({ kind: "file" });
    expect(files[`${PI}/mcp.json`]).toBe('{"mcpServers":{}}');
  });

  test("a hand edit inside a jig entry is a conflict; an unreadable file is one too, and nothing is written", async () => {
    const { ports, files, links } = fakePorts();
    await run(ports, true);
    files[MCP_JSON] = (files[MCP_JSON] ?? "").replace(
      '"command": "uvx",',
      '"command": "uvx",\n      "disabled": true,',
    );
    const edited = await run(ports, true);
    expect(edited.outcome).toBe("conflict");
    expect(edited.message).toContain(".pi/mcp.json");

    const broken = fakePorts({ files: { [MCP_JSON]: "{ nope" } });
    const report = await run(broken.ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.mcpJson.invalid).toBeDefined();
    expect(broken.files[MCP_JSON]).toBe("{ nope");
    expect(broken.links).toEqual({});
    void links;
  });
});

describe("packages, report only", () => {
  test("the repo settings file is the source; each relied-on package is present or carries its paste-able lines", async () => {
    const { ports } = fakePorts(MANAGER_SH_MACHINE);
    const { packages } = await run(ports);
    expect(packages.path).toBe(`${REPO_PI}/settings.json`);
    expect(packages.invalid).toBeUndefined();
    expect(packages.packages.map((p) => `${p.name}:${p.source ?? "MISSING"}`)).toEqual([
      "pi-mcp-adapter:MISSING",
      "@tintinweb/pi-subagents:MISSING",
    ]);
    expect(packages.packages[0]).toMatchObject({
      installLine: "pi install npm:pi-mcp-adapter",
      packagesEntry: '"npm:pi-mcp-adapter"',
    });
  });

  test("a declared package, at any version, is present; the settings file is never written", async () => {
    const { ports, files } = fakePorts({
      files: {
        [PATHS.repoSettings]: JSON.stringify({
          packages: ["npm:pi-mcp-adapter@1.0.0", { source: "npm:@tintinweb/pi-subagents" }],
        }),
      },
    });
    const { packages } = await run(ports, true);
    expect(packages.packages.map((p) => p.source)).toEqual([
      "npm:pi-mcp-adapter@1.0.0",
      "npm:@tintinweb/pi-subagents",
    ]);
    expect(files[PATHS.repoSettings]).toContain('"npm:pi-mcp-adapter@1.0.0"');
  });

  test("a missing settings file is reported, not a throw", async () => {
    const { ports, files } = fakePorts();
    delete files[PATHS.repoSettings];
    const { packages } = await run(ports);
    expect(packages.invalid).toContain("does not exist");
    expect(packages.packages.every((p) => p.source === undefined)).toBe(true);
  });
});

describe("extensions, report only", () => {
  test("manager.sh's links into the repo are named as such, everything else is not jig's, and nothing is touched", async () => {
    const { ports, links, files } = fakePorts(MANAGER_SH_MACHINE);
    const report = await run(ports, true);
    expect(report.extensions.dirState).toEqual({ kind: "dir" });
    expect(report.extensions.managerLinks).toEqual([
      { name: "gate.ts", target: `${REPO_PI}/extensions/gate.ts` },
      { name: "guard.ts", target: `${REPO_PI}/extensions/guard.ts` },
    ]);
    expect(report.extensions.foreign).toEqual([
      { name: "orca-prefill.ts", what: "a regular file" },
    ]);
    expect(links[`${PI}/extensions/guard.ts`]).toBe(`${REPO_PI}/extensions/guard.ts`);
    expect(files[`${PI}/extensions/orca-prefill.ts`]).toBeDefined();
  });

  test("an absent directory reports nothing and is not created", async () => {
    const { ports, dirs } = fakePorts();
    const report = await run(ports, true);
    expect(report.extensions.dirState).toEqual({ kind: "missing" });
    expect(report.extensions.managerLinks).toEqual([]);
    expect(dirs.has(`${PI}/extensions`)).toBe(false);
  });
});

describe("--write delivers everything in one run", () => {
  test("links, AGENTS.md, the adapter config, manifest and provenance; then a second apply is a noop", async () => {
    const { ports, files, links, manifest, provenance } = fakePorts(MANAGER_SH_MACHINE);
    const first = await run(ports, true);

    expect(first.wrote).toBe(true);
    expect(links[`${AGENTS_SKILLS}/writeup`]).toBe(`${H}/skills/writeup`);
    expect(links[`${AGENTS_SKILLS}/grilling`]).toBe(`${H}/skills/grilling`);
    expect(links[`${AGENTS_SKILLS}/retired`]).toBeUndefined();
    expect(files[`${PI}/AGENTS.md`]).toContain("# Core");
    expect(manifest[MCP_JSON]).toBe(ports.sha256(first.mcpJson.block));
    expect(manifest[`${PI}/AGENTS.md`]).toBeDefined();
    expect(provenance[PI]?.sourceFile).toBe(PATHS.mcpServers);
    // pi's own files beside the delivery are not touched.
    expect(files[`${PI}/models-store.json`]).toBe("{}");
    expect(links[`${PI}/settings.json`]).toBe(`${REPO_PI}/settings.json`);

    const second = await run(ports, true);
    expect(second.outcome).toBe("noop");
    expect(second.agentsMd.outcome).toBe("noop");
    expect(second.agentsMd.replacesSymlink).toBeUndefined();
    expect(second.mcpJson.outcome).toBe("noop");
  });
});

describe("a missing source is an error, not an empty result", () => {
  test("no MCP source", async () => {
    const { ports, files } = fakePorts();
    delete files[PATHS.mcpServers];
    expect(run(ports)).rejects.toThrow("MCP source not found");
  });
});
