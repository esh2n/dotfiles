import { describe, expect, test } from "bun:test";
import { type ClaudeApplyPaths, applyClaude } from "../../../src/app/apply/apply-claude";
import type { ClaudeApplyPorts, ProvenanceInfo } from "../../../src/app/apply/ports";
import type { JsonObject } from "../../../src/domain/compose/merge";

const PATHS: ClaudeApplyPaths = {
  guardRules: "/repo/policy/guard-rules.json",
  mcpServers: "/repo/mcp/servers.json",
  sandbox: "/repo/policy/sandbox.json",
  decisions: "/repo/rules/decisions",
  settings: "/home/u/.claude/settings.json",
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

function fakePorts(initial: Record<string, string>): {
  ports: ClaudeApplyPorts;
  files: Record<string, string>;
  manifest: Record<string, string>;
  provenance: Record<string, ProvenanceInfo>;
} {
  const files: Record<string, string> = {
    [PATHS.guardRules]: GUARD_RULES,
    [PATHS.mcpServers]: MCP_SOURCE,
    [PATHS.sandbox]: SANDBOX_SOURCE,
    [`${PATHS.decisions}/2026-09-22-one.md`]: DECISION,
    ...initial,
  };
  const manifest: Record<string, string> = {};
  const provenance: Record<string, ProvenanceInfo> = {};

  const ports: ClaudeApplyPorts = {
    async readFile(path) {
      return files[path];
    },
    async writeAtomic(path, content) {
      files[path] = content;
    },
    async listDir(path) {
      const prefix = `${path}/`;
      return Object.keys(files)
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length));
    },
    sha256(content) {
      let h = 0;
      for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
      return `fake:${h}`;
    },
    async readManifest() {
      return { ...manifest };
    },
    async writeManifest(next) {
      for (const key of Object.keys(manifest)) if (!(key in next)) delete manifest[key];
      Object.assign(manifest, next);
    },
    async writeProvenance(destDir, info) {
      provenance[destDir] = info;
    },
    now: () => new Date("2026-09-23T00:00:00.000Z"),
    jigVersion: "0.0.0-test",
  };

  return { ports, files, manifest, provenance };
}

const run = (ports: ClaudeApplyPorts, write = false) =>
  applyClaude({ paths: PATHS, hookPaths: HOOK_PATHS, write }, ports);

const LIVE_SETTINGS = JSON.stringify(
  {
    env: { YOKI_ROOT: "/yoki", GOPATH: "/go" },
    model: "claude-fable-5[1m]",
    autoMode: { allow: ["$defaults"] },
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "git-guard.sh" }] }] },
    permissions: { allow: ["Edit(./**)"], deny: ["Bash(rm *)"], defaultMode: "acceptEdits" },
    mcpServers: { "figma-desktop": { type: "http" } },
  },
  null,
  2,
);

describe("dry-run is the default", () => {
  test("nothing is written and the outcome is the plan, not the act", async () => {
    const { ports, files, manifest } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    const report = await run(ports);

    expect(report.wrote).toBe(false);
    expect(report.outcome).toBe("write");
    expect(files[PATHS.settings]).toBe(LIVE_SETTINGS);
    expect(manifest).toEqual({});
    expect(report.diff).not.toBe("");
  });
});

describe("what the composed file contains", () => {
  test("the five hooks, the projected permissions, the sandbox and the filtered MCP list", async () => {
    const { ports } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    const report = await run(ports);
    const settings = report.composition.settings;

    expect(Object.keys(settings.hooks as JsonObject)).toHaveLength(5);

    const permissions = settings.permissions as JsonObject;
    expect(permissions.deny).toEqual(["Bash(shutdown *)"]);
    expect(permissions.defaultMode).toBe("auto");
    // The six default permits, and nothing from the old 71.
    expect(permissions.allow).toEqual([
      "Bash(bun test *)",
      "Bash(git commit *)",
      "Bash(git push *)",
      "Bash(go test *)",
      "Bash(npm test *)",
      "Bash(pytest *)",
    ]);

    expect(settings.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: ["gh", "docker", "open"],
    });
  });

  test("excludedCommands comes from policy/sandbox.json, and its provenance is reported", async () => {
    const { ports } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    const report = await run(ports);
    expect(report.sandboxSourcePath).toBe(PATHS.sandbox);
  });

  test("no policy/sandbox.json means the tightest list, and says so rather than passing for a choice", async () => {
    const { ports, files } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    delete files[PATHS.sandbox];
    const report = await run(ports);

    expect(report.sandboxSourcePath).toBeUndefined();
    expect(report.composition.settings.sandbox).toMatchObject({ excludedCommands: [] });
  });

  test("a malformed policy/sandbox.json is an error, not a silently empty list", async () => {
    const { ports, files } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    files[PATHS.sandbox] = JSON.stringify({ excludedCommands: "gh" });
    expect(run(ports)).rejects.toThrow("array");
  });

  test("MCP filtering: claude=false is excluded and {{HOME}} is substituted", async () => {
    const { ports } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    const servers = (await run(ports)).composition.settings.mcpServers as JsonObject;

    expect(Object.keys(servers).sort()).toEqual(["codebase-memory-mcp", "serena"]);
    expect((servers["codebase-memory-mcp"] as JsonObject).command).toBe("/home/u/bin/cmm");
  });

  test("an ask rule has no native form and is reported as hook-only rather than guessed at", async () => {
    const { ports } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    const report = await run(ports);
    expect(report.hookOnly.map((rule) => rule.id)).toEqual(["ask-sudo"]);
  });

  test("unmanaged keys survive and the removals are named", async () => {
    const { ports } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
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
    const { ports, files, manifest, provenance } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    const report = await run(ports, true);

    expect(report.wrote).toBe(true);
    expect(files[PATHS.settings]).toBe(report.composition.settings && files[PATHS.settings]);
    expect(JSON.parse(files[PATHS.settings] ?? "{}").sandbox).toMatchObject({ enabled: true });
    expect(manifest[PATHS.settings]).toBe(ports.sha256(files[PATHS.settings] ?? ""));
    expect(provenance["/home/u/.claude"]?.sourceFile).toBe(PATHS.guardRules);
  });

  test("applying twice yields no diff the second time", async () => {
    const { ports, files } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    await run(ports, true);
    const after = files[PATHS.settings];

    const second = await run(ports, true);
    expect(second.diff).toBe("");
    expect(second.outcome).toBe("noop");
    expect(files[PATHS.settings]).toBe(after);
    expect(second.composition.removed).toEqual([]);
  });

  test("a hand edit to a key jig owns is a conflict, not something to overwrite", async () => {
    const { ports, files } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
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
  });

  test("a hand edit to a key jig does NOT own is carried through, and is not a conflict", async () => {
    const { ports, files } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
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
    const { ports } = fakePorts({});
    const report = await run(ports);
    expect(Object.keys(report.composition.settings)).toEqual([
      "hooks",
      "permissions",
      "sandbox",
      "mcpServers",
    ]);
    expect(report.composition.removed).toEqual([]);
  });
});

describe("the AGENTS.md preview", () => {
  test("is produced for the dry-run and written nowhere", async () => {
    const { ports, files } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    const before = Object.keys(files).length;
    const report = await run(ports);

    expect(report.agentsMdPreview).toContain("rules/research/INDEX.md");
    // The note's `rule:` line, not its Japanese title.
    expect(report.agentsMdPreview).toContain("- **Do the one thing.**");
    expect(report.agentsMdPreview).not.toContain("決定の題");
    expect(Object.keys(files)).toHaveLength(before);
  });

  test("an accepted note with no rule line is reported as a gap, not quietly dropped", async () => {
    const { ports, files } = fakePorts({ [PATHS.settings]: LIVE_SETTINGS });
    files[`${PATHS.decisions}/2026-09-23-two.md`] = "# 題\n\nStatus: accepted — 理由\n";
    const report = await run(ports);

    expect(report.agentsMdSkipped).toContainEqual({
      file: "2026-09-23-two.md",
      reason: expect.stringContaining("no `rule:` line"),
      missingRule: true,
    });
  });
});

describe("a missing source is an error, not an empty result", () => {
  test("no guard policy", async () => {
    const { ports, files } = fakePorts({});
    delete files[PATHS.guardRules];
    expect(run(ports)).rejects.toThrow("guard policy not found");
  });

  test("no MCP source", async () => {
    const { ports, files } = fakePorts({});
    delete files[PATHS.mcpServers];
    expect(run(ports)).rejects.toThrow("MCP source not found");
  });
});
