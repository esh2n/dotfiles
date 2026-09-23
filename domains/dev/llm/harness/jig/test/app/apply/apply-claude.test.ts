import { describe, expect, test } from "bun:test";
import { type ClaudeApplyPaths, applyClaude } from "../../../src/app/apply/apply-claude";
import type { ClaudeApplyPorts } from "../../../src/app/apply/ports";
import type { JsonObject } from "../../../src/domain/compose/merge";
import { type FakeClaudeFs, type FakeClaudeFsSeed, fakeClaudeFs } from "./fake-claude-ports";

const H = "/repo/llm/harness";
const CLAUDE = "/home/u/.claude";

const PATHS: ClaudeApplyPaths = {
  harnessRoot: H,
  guardRules: `${H}/policy/guard-rules.json`,
  mcpServers: `${H}/mcp/servers.json`,
  sandbox: `${H}/policy/sandbox.json`,
  decisions: `${H}/rules/decisions`,
  settings: `${CLAUDE}/settings.json`,
  agentsMd: `${CLAUDE}/AGENTS.md`,
  claudeMd: `${CLAUDE}/CLAUDE.md`,
  skills: `${CLAUDE}/skills`,
  agents: `${CLAUDE}/agents`,
  rulesDir: `${CLAUDE}/rules`,
  commands: `${CLAUDE}/commands`,
  scripts: `${CLAUDE}/scripts`,
  workflows: `${CLAUDE}/workflows`,
  home: "/home/u",
};

const HOOK_PATHS = { bun: "/abs/bun", jig: "/abs/jig.ts" };

/** A tiny policy: one convertible forbid, one that only the hook can express. */
const GUARD_RULES = JSON.stringify({
  version: 1,
  mode: { shell: "denylist", fs: "denylist", net: "denylist", mcp: "denylist" },
  floor: [],
  rules: [
    {
      id: "shutdown",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "shutdown" },
      why: "no",
      profiles: ["minimal", "standard", "strict"],
    },
    {
      id: "ask-sudo",
      effect: "ask",
      action: "shell.exec",
      subject: { program: "sudo" },
      why: "confirm",
      profiles: ["standard", "strict"],
    },
  ],
});

const MCP_SOURCE = JSON.stringify({
  schemaVersion: "jig.mcp.v1",
  servers: [
    {
      name: "serena",
      transport: "stdio",
      command: "uvx",
      args: ["serena"],
      targets: { claude: true, codex: true, pi: true, dsh: true },
    },
    {
      name: "playwright",
      transport: "stdio",
      command: "npx",
      args: ["playwright"],
      targets: { claude: false, codex: true },
    },
    {
      name: "codebase-memory-mcp",
      transport: "stdio",
      command: "{{HOME}}/bin/cmm",
      args: [],
      targets: { claude: true },
    },
  ],
});

const SANDBOX_SOURCE = JSON.stringify({
  _note: "the owner's list",
  excludedCommands: ["gh", "docker", "open"],
});

const DECISION = "# 決定の題\n\nStatus: accepted — 理由（2026-09-22）\n\nrule: Do the one thing.\n";

/** The sources every test starts from; the destination side is the seed. */
function fakePorts(seed: FakeClaudeFsSeed = {}): FakeClaudeFs {
  return fakeClaudeFs({
    ...seed,
    files: {
      [PATHS.guardRules]: GUARD_RULES,
      [PATHS.mcpServers]: MCP_SOURCE,
      [PATHS.sandbox]: SANDBOX_SOURCE,
      [`${PATHS.decisions}/2026-09-22-one.md`]: DECISION,
      [`${H}/rules/common/README.md`]: "# rules/common\n",
      [`${H}/rules/research/INDEX.md`]: "# index\n",
      [`${H}/skills/README.md`]: "# skills\n",
      [`${H}/skills/writeup/SKILL.md`]: "---\nname: writeup\n---\n",
      [`${H}/agents/research.md`]: "# research\n",
      ...seed.files,
    },
  });
}

const run = (ports: ClaudeApplyPorts, write = false) =>
  applyClaude({ paths: PATHS, hookPaths: HOOK_PATHS, write }, ports);

const LIVE_SETTINGS = JSON.stringify(
  {
    env: { YOKI_ROOT: "/yoki", GOPATH: "/go" },
    model: "claude-fable-5[1m]",
    autoMode: { allow: ["$defaults"] },
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "/bun /OLD/jig/src/cli/jig.ts hooks pre-tool-use --harness claude" }] }] },
    permissions: { allow: ["Edit(./**)"], deny: ["Bash(rm *)"], defaultMode: "acceptEdits" },
    mcpServers: { "figma-desktop": { type: "http" } },
  },
  null,
  2,
);

/** The machine as yoki-switch left it: staging-dir links and two hand-written files. */
const YOKI_SWITCH_MACHINE: FakeClaudeFsSeed = {
  files: {
    [PATHS.settings]: LIVE_SETTINGS,
    [PATHS.claudeMd]: "# merged by yoki-switch\n",
    [PATHS.agentsMd]: "# hand-written, April\n",
    [`${CLAUDE}/.skills-merged/writeup/SKILL.md`]: "x",
    [`${CLAUDE}/.commands-merged/plan.md`]: "x",
  },
  links: {
    [PATHS.skills]: `${CLAUDE}/.skills-merged`,
    [PATHS.agents]: `${CLAUDE}/.agents-merged`,
    [PATHS.rulesDir]: `${CLAUDE}/.rules-merged`,
    [PATHS.commands]: `${CLAUDE}/.commands-merged`,
  },
};

describe("dry-run is the default", () => {
  test("nothing is written and the outcome is the plan, not the act", async () => {
    const { ports, files, links, manifest } = fakePorts({
      files: { [PATHS.settings]: LIVE_SETTINGS },
    });
    const report = await run(ports);

    expect(report.wrote).toBe(false);
    expect(report.outcome).toBe("write");
    expect(report.settingsOutcome).toBe("write");
    expect(files[PATHS.settings]).toBe(LIVE_SETTINGS);
    expect(files[PATHS.agentsMd]).toBeUndefined();
    expect(links).toEqual({});
    expect(manifest).toEqual({});
    expect(report.diff).not.toBe("");
  });
});

describe("what the composed file contains", () => {
  test("the five hooks, the projected permissions, the sandbox and the filtered MCP list", async () => {
    const { ports } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    const report = await run(ports);
    const settings = report.composition.settings;

    expect(Object.keys(settings.hooks as JsonObject)).toHaveLength(5);

    const permissions = settings.permissions as JsonObject;
    expect(permissions.deny).toEqual(["Bash(shutdown *)"]);
    expect(permissions.defaultMode).toBe("auto");
    // The ten default permits (six of the allow-from-guard-permit decision,
    // four static checks of the hooks-carry-formatters-only one), and
    // nothing from the old 71.
    expect(permissions.allow).toEqual([
      "Bash(bun test *)",
      "Bash(cargo clippy *)",
      "Bash(git commit *)",
      "Bash(git push *)",
      "Bash(go test *)",
      "Bash(html-validate *)",
      "Bash(npm test *)",
      "Bash(pytest *)",
      "Bash(staticcheck *)",
      "Bash(stylelint *)",
    ]);

    expect(settings.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: ["gh", "docker", "open"],
    });
  });

  test("excludedCommands comes from policy/sandbox.json, and its provenance is reported", async () => {
    const { ports } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    const report = await run(ports);
    expect(report.sandboxSourcePath).toBe(PATHS.sandbox);
  });

  test("no policy/sandbox.json means the tightest list, and says so rather than passing for a choice", async () => {
    const { ports, files } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    delete files[PATHS.sandbox];
    const report = await run(ports);

    expect(report.sandboxSourcePath).toBeUndefined();
    expect(report.composition.settings.sandbox).toMatchObject({ excludedCommands: [] });
  });

  test("a malformed policy/sandbox.json is an error, not a silently empty list", async () => {
    const { ports, files } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    files[PATHS.sandbox] = JSON.stringify({ excludedCommands: "gh" });
    expect(run(ports)).rejects.toThrow("array");
  });

  test("MCP servers are claude mcp add lines, not a settings key: claude=false is excluded and {{HOME}} is substituted", async () => {
    const { ports } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    const report = await run(ports);

    expect(report.composition.settings.mcpServers).toBeUndefined();
    expect(report.composition.owned).not.toContain("mcpServers");
    expect(report.mcpAdds.map((add) => add.name)).toEqual(["serena", "codebase-memory-mcp"]);
    expect(report.mcpAdds.map((add) => add.line)).toEqual([
      "claude mcp add --transport stdio --scope user serena -- uvx serena",
      "claude mcp add --transport stdio --scope user codebase-memory-mcp -- /home/u/bin/cmm",
    ]);
  });

  test("the mcpServers key milestone 1 wrote is removed with its reason", async () => {
    const { ports } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    const { composition } = await run(ports);
    const group = composition.removed.find((removal) => removal.key === "mcpServers");
    expect(group?.items).toEqual(["figma-desktop"]);
    expect(group?.reason).toContain("settings.json is not an MCP source");
  });

  test("an ask rule has no native form and is reported as hook-only rather than guessed at", async () => {
    const { ports } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    const report = await run(ports);
    expect(report.hookOnly.map((rule) => rule.id)).toEqual(["ask-sudo"]);
  });

  test("unmanaged keys survive and the removals are named", async () => {
    const { ports } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    const { composition } = await run(ports);

    expect(composition.settings.model).toBe("claude-fable-5[1m]");
    expect(composition.settings.autoMode).toEqual({ allow: ["$defaults"] });
    expect(composition.settings.env).toEqual({ GOPATH: "/go" });

    const keys = composition.removed.map((group) => group.key).sort();
    expect(keys).toEqual([
      "env",
      "hooks.PreToolUse",
      "mcpServers",
      "permissions.allow",
      "permissions.deny",
    ]);
  });
});

describe("--write", () => {
  test("writes atomically, records the hash, and leaves a provenance sidecar", async () => {
    const { ports, files, manifest, provenance } = fakePorts({
      files: { [PATHS.settings]: LIVE_SETTINGS },
    });
    const report = await run(ports, true);

    expect(report.wrote).toBe(true);
    const written = JSON.parse(files[PATHS.settings] ?? "{}") as JsonObject;
    expect(written.sandbox).toMatchObject({ enabled: true });
    // The dead key leaves on write; the servers go through `claude mcp add` by hand.
    expect(written.mcpServers).toBeUndefined();
    expect(manifest[PATHS.settings]).toBe(ports.sha256(files[PATHS.settings] ?? ""));
    expect(provenance[CLAUDE]?.sourceFile).toBe(PATHS.guardRules);
  });

  test("applying twice yields no diff the second time", async () => {
    const { ports, files } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    await run(ports, true);
    const after = files[PATHS.settings];

    const second = await run(ports, true);
    expect(second.diff).toBe("");
    expect(second.outcome).toBe("noop");
    expect(second.settingsOutcome).toBe("noop");
    expect(second.agentsMd.outcome).toBe("noop");
    expect(second.links.map((link) => link.state)).toEqual(["ok"]);
    expect(second.skillsDir.plan.state).toBe("ok");
    expect(
      second.skillsDir.entries.map((e) => (e.kind === "link" ? e.plan.state : e.kind)),
    ).toEqual(["ok"]);
    expect(
      second.agentsDir.entries.map((e) => (e.kind === "link" ? e.plan.state : e.kind)),
    ).toEqual(["ok"]);
    expect(files[PATHS.settings]).toBe(after);
    expect(second.composition.removed).toEqual([]);
  });

  test("a hand edit to a key jig owns is a conflict, not something to overwrite", async () => {
    const { ports, files } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    await run(ports, true);

    const edited = JSON.parse(files[PATHS.settings] ?? "{}") as Record<string, unknown>;
    edited.sandbox = { enabled: false };
    files[PATHS.settings] = `${JSON.stringify(edited, null, 2)}\n`;
    const handEdited = files[PATHS.settings];

    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.wrote).toBe(false);
    expect(files[PATHS.settings]).toBe(handEdited);
    expect(report.message).toContain("hand-edit conflict");
    expect(report.message).toContain("settings.json");
  });

  test("a hand edit to a key jig does NOT own is carried through, and is not a conflict", async () => {
    const { ports, files } = fakePorts({ files: { [PATHS.settings]: LIVE_SETTINGS } });
    await run(ports, true);

    const edited = JSON.parse(files[PATHS.settings] ?? "{}") as Record<string, unknown>;
    edited.theme = "dark-daltonized";
    files[PATHS.settings] = `${JSON.stringify(edited, null, 2)}\n`;

    const report = await run(ports, true);
    // Preservation makes the regenerated text identical to the edited file, so
    // there is nothing to reconcile: the user's own key simply survives.
    expect(report.outcome).toBe("noop");
    expect(report.composition.settings.theme).toBe("dark-daltonized");
  });
});

describe("a machine with no settings.json yet", () => {
  test("composes the managed keys alone and has nothing to remove", async () => {
    const { ports } = fakePorts();
    const report = await run(ports);
    expect(Object.keys(report.composition.settings)).toEqual(["hooks", "permissions", "sandbox"]);
    expect(report.composition.removed).toEqual([]);
  });
});

describe("AGENTS.md", () => {
  test("is generated from rules/common and rules/decisions with absolute links, and sized", async () => {
    const { ports } = fakePorts({
      files: {
        [`${H}/rules/common/b-git.md`]: "# Git\n\nCommit small.\n",
        [`${H}/rules/common/a-core.md`]: "---\npaths: []\n---\n# Core\n\nBe brief.\n",
      },
    });
    const report = await run(ports);
    const { agentsMd } = report;

    expect(agentsMd.path).toBe(PATHS.agentsMd);
    expect(agentsMd.commonFiles).toEqual(["a-core.md", "b-git.md"]);
    expect(
      agentsMd.content.startsWith(`<!-- generated by jig apply --target claude from ${H}/rules/`),
    ).toBe(true);
    expect(agentsMd.content.indexOf("# Core")).toBeLessThan(agentsMd.content.indexOf("# Git"));
    expect(agentsMd.content).not.toContain("paths: []");
    expect(agentsMd.content).toContain(`](${H}/rules/research/INDEX.md)`);
    // The note's `rule:` line, not its Japanese title.
    expect(agentsMd.content).toContain(
      `- **Do the one thing.** — [2026-09-22-one.md](${H}/rules/decisions/2026-09-22-one.md)`,
    );
    expect(agentsMd.content).not.toContain("決定の題");
    expect(agentsMd.bytes).toBe(Buffer.byteLength(agentsMd.content));
    expect(agentsMd.overLimit).toBe(false);
  });

  test("rules/common/README.md is not a rule and is not rendered", async () => {
    const { ports } = fakePorts();
    const report = await run(ports);
    expect(report.agentsMd.commonFiles).toEqual([]);
    expect(report.agentsMd.content).not.toContain("# rules/common");
  });

  test("past 32 KiB it is reported, not refused", async () => {
    const { ports } = fakePorts({
      files: { [`${H}/rules/common/big.md`]: `# Big\n\n${"x".repeat(33 * 1024)}\n` },
    });
    const report = await run(ports);
    expect(report.agentsMd.overLimit).toBe(true);
    expect(report.outcome).toBe("write");
  });

  test("an accepted note with no rule line is reported as a gap, not quietly dropped", async () => {
    const { ports } = fakePorts({
      files: { [`${PATHS.decisions}/2026-09-23-two.md`]: "# 題\n\nStatus: accepted — 理由\n" },
    });
    const report = await run(ports);

    expect(report.agentsMd.skipped).toContainEqual({
      file: "2026-09-23-two.md",
      reason: expect.stringContaining("no `rule:` line"),
      missingRule: true,
    });
  });

  test("--write lands it, records its hash, and keeps a file jig never wrote under a dated name", async () => {
    const { ports, files, manifest } = fakePorts(YOKI_SWITCH_MACHINE);
    const dry = await run(ports);
    expect(dry.agentsMd.backupPath).toBe(`${PATHS.agentsMd}.pre-jig.20260923-000000`);

    const report = await run(ports, true);
    expect(report.wrote).toBe(true);
    expect(files[PATHS.agentsMd]).toBe(report.agentsMd.content);
    expect(files[`${PATHS.agentsMd}.pre-jig.20260923-000000`]).toBe("# hand-written, April\n");
    expect(manifest[PATHS.agentsMd]).toBe(ports.sha256(report.agentsMd.content));
  });

  test("a hand edit after jig wrote it is a conflict for the whole delivery, and nothing is written", async () => {
    const { ports, files, links } = fakePorts(YOKI_SWITCH_MACHINE);
    await run(ports, true);
    files[PATHS.agentsMd] = "# edited by hand\n";
    // Remove the writeup link jig made, so there is a link change pending too.
    delete links[`${PATHS.skills}/writeup`];

    const report = await run(ports, true);
    expect(report.outcome).toBe("conflict");
    expect(report.wrote).toBe(false);
    expect(report.message).toContain("AGENTS.md");
    expect(files[PATHS.agentsMd]).toBe("# edited by hand\n");
    expect(links[`${PATHS.skills}/writeup`]).toBeUndefined();
  });

  test("a regenerated file after a source change is a plain write: the manifest hash still matches", async () => {
    const { ports, files } = fakePorts(YOKI_SWITCH_MACHINE);
    await run(ports, true);
    files[`${H}/rules/common/new.md`] = "# New\n\nA new always-on rule.\n";

    const report = await run(ports, true);
    expect(report.agentsMd.outcome).toBe("write");
    expect(report.wrote).toBe(true);
    expect(files[PATHS.agentsMd]).toContain("A new always-on rule.");
    // No second backup: the file being replaced was jig's own.
    expect(Object.keys(files).filter((f) => f.includes(".pre-jig."))).toHaveLength(2);
  });
});

describe("the links and directories, on the machine yoki-switch left", () => {
  test("the dry-run says exactly what happens to each destination", async () => {
    const { ports } = fakePorts(YOKI_SWITCH_MACHINE);
    const report = await run(ports);

    expect(report.links).toEqual([
      {
        path: PATHS.claudeMd,
        target: "AGENTS.md",
        state: "backup-then-create",
        backupPath: `${PATHS.claudeMd}.pre-jig.20260923-000000`,
      },
    ]);
    // The three staging links become real directories; the entries are planned
    // as `create` because a symlink has no entries of its own to reconcile.
    expect(report.skillsDir.plan).toMatchObject({
      state: "replace",
      previousTarget: `${CLAUDE}/.skills-merged`,
    });
    expect(report.skillsDir.entries).toEqual([
      {
        kind: "link",
        name: "writeup",
        plan: { path: `${PATHS.skills}/writeup`, target: `${H}/skills/writeup`, state: "create" },
      },
    ]);
    expect(report.agentsDir.plan).toMatchObject({
      state: "replace",
      previousTarget: `${CLAUDE}/.agents-merged`,
    });
    expect(report.agentsDir.entries).toEqual([
      {
        kind: "link",
        name: "research.md",
        plan: {
          path: `${PATHS.agents}/research.md`,
          target: `${H}/agents/research.md`,
          state: "create",
        },
      },
    ]);
    expect(report.rulesDir.plan).toMatchObject({
      state: "replace",
      previousTarget: `${CLAUDE}/.rules-merged`,
    });
    expect(report.commands.action).toEqual({
      kind: "remove",
      reason: `a symlink → ${CLAUDE}/.commands-merged`,
    });
  });

  test("--write turns the staging links into directories of links, keeps CLAUDE.md aside, and leaves the staging dirs alone", async () => {
    const { ports, files, links, dirs } = fakePorts(YOKI_SWITCH_MACHINE);
    const report = await run(ports, true);

    expect(report.wrote).toBe(true);
    expect(links[PATHS.claudeMd]).toBe("AGENTS.md");
    expect(files[`${PATHS.claudeMd}.pre-jig.20260923-000000`]).toBe("# merged by yoki-switch\n");
    expect(files[PATHS.claudeMd]).toBeUndefined();
    // skills and agents are real directories now, one link per entry — never a
    // link to the tree, or Claude Code's own synced/ writes would land in git.
    expect(links[PATHS.skills]).toBeUndefined();
    expect(dirs.has(PATHS.skills)).toBe(true);
    expect(links[`${PATHS.skills}/writeup`]).toBe(`${H}/skills/writeup`);
    expect(links[`${PATHS.skills}/README.md`]).toBeUndefined();
    expect(links[PATHS.agents]).toBeUndefined();
    expect(dirs.has(PATHS.agents)).toBe(true);
    expect(links[`${PATHS.agents}/research.md`]).toBe(`${H}/agents/research.md`);
    // The rules directory is now real and empty of links (no conditional dirs exist yet).
    expect(links[PATHS.rulesDir]).toBeUndefined();
    expect(dirs.has(PATHS.rulesDir)).toBe(true);
    // commands is gone; its staging dir is not.
    expect(links[PATHS.commands]).toBeUndefined();
    expect(files[`${CLAUDE}/.commands-merged/plan.md`]).toBe("x");
    expect(files[`${CLAUDE}/.skills-merged/writeup/SKILL.md`]).toBe("x");
  });

  test("a real directory where CLAUDE.md should go is renamed aside, never deleted", async () => {
    const { ports, files, links } = fakePorts({
      files: { [`${PATHS.claudeMd}/notes.md`]: "mine" },
    });
    const dry = await run(ports);
    expect(dry.links[0]).toMatchObject({ state: "backup-then-create" });
    expect(dry.outcome).toBe("write");

    await run(ports, true);
    expect(files[`${PATHS.claudeMd}.pre-jig.20260923-000000/notes.md`]).toBe("mine");
    expect(links[PATHS.claudeMd]).toBe("AGENTS.md");
  });
});

describe("the skills directory", () => {
  /** What Claude Code itself keeps in ~/.claude/skills: the synced tree and its marker. */
  const CLAUDE_CODES_OWN: FakeClaudeFsSeed = {
    files: {
      [`${PATHS.skills}/synced/bucket-1/remote-skill/SKILL.md`]: "synced",
      [`${PATHS.skills}/.bucket-bucket-1`]: "",
    },
  };

  test("one link per directory holding SKILL.md; the README and a directory without one are not linked, with why", async () => {
    const { ports } = fakePorts({
      files: {
        [`${H}/skills/eli5/SKILL.md`]: "---\nname: eli5\n---\n",
        [`${H}/skills/archive/old.md`]: "not a skill",
      },
    });
    const report = await run(ports);

    expect(report.skillsDir.selection.linked).toEqual(["eli5", "writeup"]);
    expect(report.skillsDir.selection.excluded).toEqual([
      { name: "README.md", reason: "a file, not a skill directory" },
      { name: "archive", reason: "no SKILL.md inside, so not a skill" },
    ]);
  });

  test("Claude Code's synced tree and marker are not jig's: reported, and untouched by --write", async () => {
    const { ports, files, links } = fakePorts(CLAUDE_CODES_OWN);
    const dry = await run(ports);
    expect(dry.skillsDir.plan.state).toBe("ok");
    expect(dry.skillsDir.entries).toEqual([
      {
        kind: "link",
        name: "writeup",
        plan: { path: `${PATHS.skills}/writeup`, target: `${H}/skills/writeup`, state: "create" },
      },
      {
        kind: "foreign",
        name: ".bucket-bucket-1",
        path: `${PATHS.skills}/.bucket-bucket-1`,
        what: "a regular file",
      },
      { kind: "foreign", name: "synced", path: `${PATHS.skills}/synced`, what: "a directory" },
    ]);

    await run(ports, true);
    expect(links[`${PATHS.skills}/writeup`]).toBe(`${H}/skills/writeup`);
    expect(files[`${PATHS.skills}/synced/bucket-1/remote-skill/SKILL.md`]).toBe("synced");
    expect(files[`${PATHS.skills}/.bucket-bucket-1`]).toBe("");
    // The tree was never linked into the harness: nothing of Claude Code's is in git sources.
    expect(links[PATHS.skills]).toBeUndefined();
  });

  test("a link into the harness's skills/ that is no longer planned is stale and removed; one elsewhere is not jig's", async () => {
    const { ports, links } = fakePorts({
      links: {
        [`${PATHS.skills}/retired`]: `${H}/skills/retired`,
        [`${PATHS.skills}/mine`]: "/somewhere/else/mine",
      },
    });
    const dry = await run(ports);
    expect(dry.skillsDir.entries.map((e) => `${e.name}:${e.kind}`)).toEqual([
      "writeup:link",
      "retired:stale",
      "mine:foreign",
    ]);

    await run(ports, true);
    expect(links[`${PATHS.skills}/retired`]).toBeUndefined();
    expect(links[`${PATHS.skills}/mine`]).toBe("/somewhere/else/mine");
  });

  test("a user's real directory where a skill link should go is renamed aside, never deleted", async () => {
    const { ports, files, links } = fakePorts({
      files: { [`${PATHS.skills}/writeup/SKILL.md`]: "my own writeup" },
    });
    const dry = await run(ports);
    expect(dry.skillsDir.entries[0]).toMatchObject({
      kind: "link",
      plan: {
        state: "backup-then-create",
        backupPath: `${PATHS.skills}/writeup.pre-jig.20260923-000000`,
      },
    });

    await run(ports, true);
    expect(files[`${PATHS.skills}/writeup.pre-jig.20260923-000000/SKILL.md`]).toBe(
      "my own writeup",
    );
    expect(links[`${PATHS.skills}/writeup`]).toBe(`${H}/skills/writeup`);
  });
});

describe("the agents directory", () => {
  test("one link per *.md file; anything else in agents/ is not linked, with why", async () => {
    const { ports, links } = fakePorts({
      files: {
        [`${H}/agents/architect.md`]: "# architect\n",
        [`${H}/agents/notes.txt`]: "x",
      },
    });
    const report = await run(ports, true);

    expect(report.agentsDir.selection.linked).toEqual(["architect.md", "research.md"]);
    expect(report.agentsDir.selection.excluded).toEqual([
      { name: "notes.txt", reason: "not a *.md file" },
    ]);
    expect(links[`${PATHS.agents}/architect.md`]).toBe(`${H}/agents/architect.md`);
    expect(links[`${PATHS.agents}/research.md`]).toBe(`${H}/agents/research.md`);
    expect(links[`${PATHS.agents}/notes.txt`]).toBeUndefined();
  });

  test("a removed source file leaves a stale link that the next write removes; a user's own file stays", async () => {
    const { ports, files, links } = fakePorts({
      files: { [`${PATHS.agents}/mine.md`]: "my agent" },
    });
    await run(ports, true);
    delete files[`${H}/agents/research.md`];

    const dry = await run(ports);
    expect(dry.agentsDir.entries.map((e) => `${e.name}:${e.kind}`)).toEqual([
      "research.md:stale",
      "mine.md:foreign",
    ]);

    await run(ports, true);
    expect(links[`${PATHS.agents}/research.md`]).toBeUndefined();
    expect(files[`${PATHS.agents}/mine.md`]).toBe("my agent");
  });
});

describe("the rules directory", () => {
  const withLangs: FakeClaudeFsSeed = {
    files: {
      [`${H}/rules/typescript/style.md`]: "---\npaths:\n  - '**/*.ts'\n---\n# TS\n",
      [`${H}/rules/go/errors.md`]: "---\npaths:\n  - '**/*.go'\n---\n# Go\n",
      [`${H}/rules/README.md`]: "# rules\n",
    },
  };

  test("every subdirectory except common, decisions and research gets a link; the README is a file, not a candidate", async () => {
    const { ports } = fakePorts(withLangs);
    const report = await run(ports);

    expect(report.rulesDir.selection.linked).toEqual(["go", "typescript"]);
    expect(report.rulesDir.selection.excluded.map((e) => e.name)).toEqual([
      "common",
      "decisions",
      "research",
    ]);
    expect(report.rulesDir.plan.state).toBe("create");
    expect(report.rulesDir.entries).toEqual([
      {
        kind: "link",
        name: "go",
        plan: { path: `${PATHS.rulesDir}/go`, target: `${H}/rules/go`, state: "create" },
      },
      {
        kind: "link",
        name: "typescript",
        plan: {
          path: `${PATHS.rulesDir}/typescript`,
          target: `${H}/rules/typescript`,
          state: "create",
        },
      },
    ]);
  });

  test("--write creates the directory and its links; a removed source directory leaves a stale link that the next write removes", async () => {
    const { ports, files, links } = fakePorts(withLangs);
    await run(ports, true);
    expect(links[`${PATHS.rulesDir}/go`]).toBe(`${H}/rules/go`);
    expect(links[`${PATHS.rulesDir}/typescript`]).toBe(`${H}/rules/typescript`);

    delete files[`${H}/rules/go/errors.md`];
    const dry = await run(ports);
    expect(dry.rulesDir.entries).toContainEqual({
      kind: "stale",
      name: "go",
      path: `${PATHS.rulesDir}/go`,
      target: `${H}/rules/go`,
      reason: "unplanned",
    });
    expect(dry.outcome).toBe("write");

    await run(ports, true);
    expect(links[`${PATHS.rulesDir}/go`]).toBeUndefined();
    expect(links[`${PATHS.rulesDir}/typescript`]).toBe(`${H}/rules/typescript`);
  });

  test("an entry that is not jig's is reported and left exactly as it is", async () => {
    const { ports, files, links } = fakePorts({
      ...withLangs,
      files: { ...withLangs.files, [`${PATHS.rulesDir}/mine.md`]: "my rule" },
      links: { [`${PATHS.rulesDir}/elsewhere`]: "/somewhere/else" },
    });
    const report = await run(ports, true);

    expect(report.rulesDir.entries.filter((e) => e.kind === "foreign").map((e) => e.name)).toEqual([
      "elsewhere",
      "mine.md",
    ]);
    expect(files[`${PATHS.rulesDir}/mine.md`]).toBe("my rule");
    expect(links[`${PATHS.rulesDir}/elsewhere`]).toBe("/somewhere/else");
  });

  test("common is never linked, even though it is a directory under rules/", async () => {
    const { ports, links } = fakePorts({
      files: { [`${H}/rules/common/core.md`]: "# Core\n" },
    });
    const report = await run(ports, true);
    expect(report.rulesDir.selection.linked).toEqual([]);
    expect(links[`${PATHS.rulesDir}/common`]).toBeUndefined();
    expect(report.agentsMd.content).toContain("# Core");
  });
});

describe("the retired commands directory", () => {
  test("absent is nothing to do", async () => {
    const { ports } = fakePorts();
    expect((await run(ports)).commands.action).toEqual({ kind: "absent" });
  });

  test("a directory of symlinks is removed on --write", async () => {
    const { ports, links } = fakePorts({
      links: { [`${PATHS.commands}/plan.md`]: "/repo/commands/plan.md" },
    });
    const dry = await run(ports);
    expect(dry.commands.action.kind).toBe("remove");

    await run(ports, true);
    expect(links[`${PATHS.commands}/plan.md`]).toBeUndefined();
  });

  test("a directory holding a real file is a conflict, and nothing in the delivery is written", async () => {
    const { ports, files, links } = fakePorts({
      files: { [`${PATHS.commands}/mine.md`]: "my command" },
    });
    const report = await run(ports, true);

    expect(report.outcome).toBe("conflict");
    expect(report.wrote).toBe(false);
    expect(report.message).toContain("commands");
    expect(files[`${PATHS.commands}/mine.md`]).toBe("my command");
    expect(links).toEqual({});
    expect(files[PATHS.agentsMd]).toBeUndefined();
  });
});

describe("milestone 4: scripts and workflows", () => {
  const YOKI_LINKS = {
    [PATHS.scripts]: `${CLAUDE}/.scripts-merged`,
    [PATHS.workflows]: `${CLAUDE}/.workflows-merged`,
  };

  test("with no H/scripts and no H/workflows yet, nothing is planned and the destinations are left as found", async () => {
    const { ports, links } = fakePorts({ links: YOKI_LINKS });
    const report = await run(ports, true);

    expect(report.scriptsDir.dir).toBeUndefined();
    expect(report.scriptsDir.sourceDir).toBe(`${H}/scripts`);
    expect(report.scriptsDir.destinationState).toEqual({
      kind: "symlink",
      target: `${CLAUDE}/.scripts-merged`,
    });
    expect(report.workflowsDir.dir).toBeUndefined();
    // The yoki-switch links stay: statusline.sh is still served through them.
    expect(links[PATHS.scripts]).toBe(`${CLAUDE}/.scripts-merged`);
    expect(links[PATHS.workflows]).toBe(`${CLAUDE}/.workflows-merged`);
  });

  test("once the sources exist, the links are replaced by managed directories, exactly as skills was", async () => {
    const { ports, links, dirs } = fakePorts({
      links: YOKI_LINKS,
      files: {
        [`${H}/scripts/statusline.sh`]: "#!/bin/sh\n",
        [`${H}/scripts/README.md`]: "# scripts\n",
        [`${H}/workflows/review.js`]: "// review\n",
        [`${H}/workflows/lib/lanes.js`]: "// lanes\n",
        [`${H}/workflows/README.md`]: "# workflows\n",
      },
    });
    const dry = await run(ports);
    expect(dry.scriptsDir.dir?.plan.state).toBe("replace");
    expect(dry.scriptsDir.dir?.selection.linked).toEqual(["statusline.sh"]);
    expect(dry.workflowsDir.dir?.plan.state).toBe("replace");
    expect(dry.workflowsDir.dir?.selection.linked).toEqual(["lib", "review.js"]);
    expect(dry.outcome).toBe("write");

    const report = await run(ports, true);
    expect(report.wrote).toBe(true);
    expect(dirs.has(PATHS.scripts)).toBe(true);
    expect(links[`${PATHS.scripts}/statusline.sh`]).toBe(`${H}/scripts/statusline.sh`);
    expect(links[`${PATHS.scripts}/README.md`]).toBeUndefined();
    expect(dirs.has(PATHS.workflows)).toBe(true);
    expect(links[`${PATHS.workflows}/review.js`]).toBe(`${H}/workflows/review.js`);
    expect(links[`${PATHS.workflows}/lib`]).toBe(`${H}/workflows/lib`);

    // The second run finds every link ok.
    const again = await run(ports);
    expect(again.scriptsDir.dir?.plan.state).toBe("ok");
    expect(again.workflowsDir.dir?.plan.state).toBe("ok");
  });

  test("a user's own file in the destination is not jig's and is left alone", async () => {
    const { ports, files } = fakePorts({
      files: {
        [`${H}/scripts/statusline.sh`]: "#!/bin/sh\n",
        [`${PATHS.scripts}/mine.sh`]: "mine",
      },
    });
    const report = await run(ports, true);
    expect(report.scriptsDir.dir?.entries.map((e) => [e.name, e.kind])).toEqual([
      ["statusline.sh", "link"],
      ["mine.sh", "foreign"],
    ]);
    expect(files[`${PATHS.scripts}/mine.sh`]).toBe("mine");
  });
});

describe("a missing source is an error, not an empty result", () => {
  test("no guard policy", async () => {
    const { ports, files } = fakePorts();
    delete files[PATHS.guardRules];
    expect(run(ports)).rejects.toThrow("guard policy not found");
  });

  test("no MCP source", async () => {
    const { ports, files } = fakePorts();
    delete files[PATHS.mcpServers];
    expect(run(ports)).rejects.toThrow("MCP source not found");
  });
});
