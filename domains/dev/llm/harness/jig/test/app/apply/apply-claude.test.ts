import { describe, expect, test } from "bun:test";
import { type ClaudeApplyPaths, applyClaudeSettings, parseEnabledPacks } from "../../../src/app/apply/apply-claude";
import type { ApplyPorts, ProvenanceInfo } from "../../../src/app/apply/ports";

function fakePorts(initialFiles: Record<string, string>): {
  ports: ApplyPorts;
  files: Record<string, string>;
} {
  const files: Record<string, string> = { ...initialFiles };
  const manifest: Record<string, string> = {};
  const provenance: Record<string, ProvenanceInfo> = {};

  const ports: ApplyPorts = {
    async readFile(path) {
      return files[path];
    },
    async writeAtomic(path, content) {
      files[path] = content;
    },
    sha256(content) {
      let h = 0;
      for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
      return `fake:${h}`;
    },
    async readManifest() {
      return {};
    },
    async writeManifest() {},
    async writeProvenance(destDir, info) {
      provenance[destDir] = info;
    },
    now: () => new Date("2026-09-20T00:00:00.000Z"),
    jigVersion: "0.0.0-test",
  };

  return { ports, files };
}

const paths: ClaudeApplyPaths = {
  packsFile: "/claude/.claude-packs",
  packsDefaultFile: "/profiles/packs.default",
  coreDir: "/profiles/core",
  packsDir: "/profiles/packs",
  personalDir: "/profiles/personal",
  destSettingsPath: "/claude/settings.json",
  templateVars: {
    HOME: "/home/u",
    DOTFILES_ROOT: "/dotfiles",
    USER: "u",
    DOTFILES_PARENT: "/dotfiles-parent",
  },
};

describe("parseEnabledPacks", () => {
  test("strips blank lines and full-line comments, dedupes, sorts", () => {
    expect(parseEnabledPacks("go\n# a comment\n\nts\ngo\n")).toEqual(["go", "ts"]);
  });

  test("an empty file has no enabled packs", () => {
    expect(parseEnabledPacks("")).toEqual([]);
  });
});

describe("applyClaudeSettings", () => {
  test("composes core + personal (personal wins scalar keys, hooks concat personal-first)", async () => {
    const { ports } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({
        model: "core-model",
        env: { FOO: "core" },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "core-hook" }] }] },
      }),
      "/profiles/personal/settings.personal.json": JSON.stringify({
        model: "personal-model",
        env: { FOO: "personal" },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "personal-hook" }] }],
        },
      }),
      "/profiles/core/permissions.yaml": 'allow:\n  - pattern: "A"\ndeny:\n  - pattern: "D1"\ndefaultMode: auto\n',
      "/profiles/personal/permissions.yaml":
        'allow:\n  - pattern: "B"\ndeny:\n  - pattern: "D2"\ndefaultMode: auto\n',
    });

    const result = await applyClaudeSettings(paths, ports, false);
    expect(result.target).toBe("claude");
    expect(result.outcome).toBe("write");
    expect(result.wrote).toBe(false);

    // The diff is against an absent dest, so it embeds the full generated
    // text — pull it back out of the "+"-prefixed lines to assert on shape.
    const generated = JSON.parse(
      result.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n"),
    );

    expect(generated.model).toBe("personal-model");
    expect(generated.env.FOO).toBe("personal");
    expect(generated.hooks.PreToolUse[0].hooks[0].command).toBe("personal-hook");
    expect(generated.hooks.PreToolUse[1].hooks[0].command).toBe("core-hook");
    expect(generated.permissions.allow).toEqual(["A", "B"]);
    expect(generated.permissions.deny).toEqual(["D1", "D2"]);
    expect(generated.permissions.defaultMode).toBe("auto");
    expect(generated.mcpServers).toEqual({});
  });

  test("missing permissions.yaml/mcp.json layers are treated as empty, not an error", async () => {
    const { ports } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({ model: "core-model" }),
    });

    const result = await applyClaudeSettings(paths, ports, false);
    expect(result.outcome).toBe("write");
  });

  test("mcp.json layers compose into mcpServers, later layer wins by name", async () => {
    const { ports } = fakePorts({
      "/profiles/core/settings.layer.json": "{}",
      "/profiles/core/mcp.json": JSON.stringify({
        schemaVersion: "jig.mcp.v1",
        servers: [
          {
            name: "s1",
            transport: "http",
            url: "https://core.example/mcp",
            targets: { claude: true },
          },
        ],
      }),
      "/profiles/personal/mcp.json": JSON.stringify({
        schemaVersion: "jig.mcp.v1",
        servers: [{ name: "s2", transport: "stdio", command: "p-cmd", targets: { claude: true } }],
      }),
    });

    const result = await applyClaudeSettings(paths, ports, false);
    const generated = JSON.parse(
      result.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n"),
    );
    expect(generated.mcpServers["s1"].url).toBe("https://core.example/mcp");
    expect(generated.mcpServers["s2"].command).toBe("p-cmd");
  });

  test("an enabled pack contributes its settings.layer.json layer", async () => {
    const { ports } = fakePorts({
      "/claude/.claude-packs": "go\n",
      "/profiles/core/settings.layer.json": JSON.stringify({ env: { FOO: "core" } }),
      "/profiles/packs/go/settings.layer.json": JSON.stringify({ env: { FOO: "go" } }),
    });

    const result = await applyClaudeSettings(paths, ports, false);
    const generated = JSON.parse(
      result.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n"),
    );
    expect(generated.env.FOO).toBe("go");
  });

  test("an enabled pack with no settings.layer.json contributes nothing (no error)", async () => {
    const { ports } = fakePorts({
      "/claude/.claude-packs": "ghost\n",
      "/profiles/core/settings.layer.json": JSON.stringify({ env: { FOO: "core" } }),
    });

    const result = await applyClaudeSettings(paths, ports, false);
    const generated = JSON.parse(
      result.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n"),
    );
    expect(generated.env.FOO).toBe("core");
  });

  test("no enabled packs file falls back to packs.default (dry-run PLAN_MODE parity)", async () => {
    const { ports } = fakePorts({
      "/profiles/packs.default": "go\n",
      "/profiles/core/settings.layer.json": JSON.stringify({ env: { FOO: "core" } }),
      "/profiles/packs/go/settings.layer.json": JSON.stringify({ env: { FOO: "go" } }),
    });

    const result = await applyClaudeSettings(paths, ports, false);
    const generated = JSON.parse(
      result.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n"),
    );
    expect(generated.env.FOO).toBe("go");
  });

  test("{{DOTFILES_PARENT}} and other template vars are substituted", async () => {
    const { ports } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({ env: { P: "{{DOTFILES_PARENT}}/x" } }),
    });

    const result = await applyClaudeSettings(paths, ports, false);
    const generated = JSON.parse(
      result.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n"),
    );
    expect(generated.env.P).toBe("/dotfiles-parent/x");
  });

  test("--write is always refused, diff is still computed, nothing is written", async () => {
    const { ports, files } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({ model: "core-model" }),
    });

    const result = await applyClaudeSettings(paths, ports, true);
    expect(result.outcome).toBe("refused");
    expect(result.wrote).toBe(false);
    expect(result.message).toMatch(/deferred/);
    expect(result.diff).not.toBe("");
    expect(files["/claude/settings.json"]).toBeUndefined();
  });

  test("an identical current settings.json produces no diff (noop)", async () => {
    const { ports } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({ model: "core-model" }),
    });

    // First pass: get the generated text out of a "no current file" diff.
    const first = await applyClaudeSettings(paths, ports, false);
    const generatedText = `${first.diff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n")}\n`;

    const { ports: ports2 } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({ model: "core-model" }),
      "/claude/settings.json": generatedText,
    });
    const second = await applyClaudeSettings(paths, ports2, false);
    expect(second.outcome).toBe("noop");
    expect(second.diff).toBe("");
  });

  test(".autoMode on the current side is normalized away before diffing", async () => {
    const { ports } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({ model: "core-model" }),
    });
    const first = await applyClaudeSettings(paths, ports, false);
    const generatedText = `${first.diff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n")}\n`;

    const withAutoMode = JSON.stringify({ ...JSON.parse(generatedText), autoMode: { x: 1 } }, null, 2);
    const { ports: ports2 } = fakePorts({
      "/profiles/core/settings.layer.json": JSON.stringify({ model: "core-model" }),
      "/claude/settings.json": withAutoMode,
    });
    const second = await applyClaudeSettings(paths, ports2, false);
    expect(second.outcome).toBe("noop");
    expect(second.diff).toBe("");
  });
});
