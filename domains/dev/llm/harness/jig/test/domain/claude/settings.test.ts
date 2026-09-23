import { describe, expect, test } from "bun:test";
import {
  type ClaudeManagedInput,
  composeClaudeSettings,
  renderClaudeSettings,
} from "../../../src/domain/claude/settings";
import type { JsonObject } from "../../../src/domain/compose/merge";

const MANAGED: ClaudeManagedInput = {
  hooks: {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "/bun /jig guard", timeout: 10 }] },
    ],
    Stop: [{ hooks: [{ type: "command", command: "/bun /jig gate", timeout: 300 }] }],
  },
  allow: ["Bash(git commit *)"],
  deny: ["Bash(shutdown *)"],
  defaultMode: "auto",
  sandbox: { enabled: true },
};

describe("keys jig does not own survive untouched", () => {
  test("every unmanaged top-level key keeps its value and its position", () => {
    const current: JsonObject = {
      env: { PATH_LIKE: "x" },
      autoMode: { allow: ["$defaults"] },
      model: "claude-fable-5[1m]",
      effortLevel: "high",
      statusLine: { type: "command", command: "~/.claude/scripts/statusline.sh" },
      enabledPlugins: { "crit@crit": true },
      hooks: { Notification: [] },
    };

    const { settings } = composeClaudeSettings(current, MANAGED);

    expect(settings.autoMode).toEqual(current.autoMode);
    expect(settings.model).toBe("claude-fable-5[1m]");
    expect(settings.effortLevel).toBe("high");
    expect(settings.statusLine).toEqual(current.statusLine);
    expect(settings.enabledPlugins).toEqual(current.enabledPlugins);
    // Order preserved: managed keys are replaced in place, new ones appended.
    expect(Object.keys(settings)).toEqual([
      "env",
      "autoMode",
      "model",
      "effortLevel",
      "statusLine",
      "enabledPlugins",
      "hooks",
      "permissions",
      "sandbox",
    ]);
  });

  test("permission sub-keys jig does not own are kept and reported as left", () => {
    const current: JsonObject = {
      permissions: { ask: ["Bash(sudo *)"], additionalDirectories: ["/tmp"], allow: [], deny: [] },
    };

    const result = composeClaudeSettings(current, MANAGED);
    const permissions = result.settings.permissions as JsonObject;

    expect(permissions.ask).toEqual(["Bash(sudo *)"]);
    expect(permissions.additionalDirectories).toEqual(["/tmp"]);
    expect(result.left).toContain("permissions.ask");
    expect(result.left).toContain("permissions.additionalDirectories");
  });

  test("a missing settings.json composes the managed keys and nothing else", () => {
    const { settings, left, removed } = composeClaudeSettings(undefined, MANAGED);

    expect(Object.keys(settings)).toEqual(["hooks", "permissions", "sandbox"]);
    expect(left).toEqual([]);
    expect(removed).toEqual([]);
    expect((settings.permissions as JsonObject).defaultMode).toBe("auto");
  });
});

describe("what the apply takes away is listed, not silently dropped", () => {
  test("every hook command that is not in the new five is reported per event", () => {
    const current: JsonObject = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "git-guard.sh" }] },
          { matcher: "Bash", hooks: [{ type: "command", command: "rtk-rewrite.sh" }] },
        ],
        Notification: [{ hooks: [{ type: "command", command: "osascript ..." }] }],
      },
    };

    const { removed } = composeClaudeSettings(current, MANAGED);

    expect(removed).toContainEqual({
      key: "hooks.PreToolUse",
      items: ["git-guard.sh", "rtk-rewrite.sh"],
    });
    expect(removed).toContainEqual({ key: "hooks.Notification", items: ["osascript ..."] });
  });

  test("a hook whose shape jig does not recognize is still reported as leaving", () => {
    const current: JsonObject = { hooks: { Stop: [{ nonsense: true }, "string"] } };
    const { removed } = composeClaudeSettings(current, MANAGED);
    expect(removed).toContainEqual({
      key: "hooks.Stop",
      items: ["(entry with no hooks array)", "(unrecognized entry)"],
    });
  });

  test("dropped allow and deny rules, and only the dropped ones, are listed", () => {
    const current: JsonObject = {
      permissions: {
        allow: ["Bash(git commit *)", "Edit(./**)", "WebFetch(domain:*)"],
        deny: ["Bash(shutdown *)", "Bash(rm -rf /*)"],
      },
    };

    const { removed } = composeClaudeSettings(current, MANAGED);

    expect(removed).toContainEqual({
      key: "permissions.allow",
      items: ["Edit(./**)", "WebFetch(domain:*)"],
    });
    expect(removed).toContainEqual({ key: "permissions.deny", items: ["Bash(rm -rf /*)"] });
  });

  test("the retiring harness's env keys go, every other env key stays, named with its value", () => {
    const current: JsonObject = {
      env: {
        YOKI_ROOT: "/somewhere/yoki",
        YOKI_HOOK_PROFILE: "standard",
        // Not YOKI_-prefixed, but its value names the runtime being retired.
        CLAUDE_PLUGIN_ROOT: "/somewhere/yoki",
        GOPATH: "/Users/x/go",
        CLAUDECODE: "1",
      },
    };

    const { settings, removed } = composeClaudeSettings(current, MANAGED);

    expect(settings.env).toEqual({ GOPATH: "/Users/x/go", CLAUDECODE: "1" });
    expect(removed).toContainEqual({
      key: "env",
      items: [
        'YOKI_ROOT="/somewhere/yoki"',
        'YOKI_HOOK_PROFILE="standard"',
        'CLAUDE_PLUGIN_ROOT="/somewhere/yoki"',
      ],
    });
  });

  test("a key that merely looks Claude-ish is not swept up with the retiring ones", () => {
    const current: JsonObject = {
      env: { CLAUDE_CODE_ENABLE_TELEMETRY: "0", CLAUDECODE: "1", CLAUDE_PLUGIN_ROOT: "/yoki" },
    };
    const { settings } = composeClaudeSettings(current, MANAGED);
    expect(settings.env).toEqual({ CLAUDE_CODE_ENABLE_TELEMETRY: "0", CLAUDECODE: "1" });
  });

  test("a leftover mcpServers key is jig's own dead value: removed whole, named, with the reason", () => {
    const current: JsonObject = {
      mcpServers: { serena: { type: "stdio" }, "figma-desktop": { type: "http" } },
      model: "x",
    };
    const { settings, left, removed } = composeClaudeSettings(current, MANAGED);

    expect(settings.mcpServers).toBeUndefined();
    expect(Object.keys(settings)).toEqual(["model", "hooks", "permissions", "sandbox"]);
    expect(left).toEqual(["model"]);
    expect(removed).toContainEqual({
      key: "mcpServers",
      items: ["serena", "figma-desktop"],
      reason:
        "settings.json is not an MCP source (docs: mcp.md); delivered through `claude mcp add` instead",
    });
  });

  test("a mcpServers value of a shape jig does not recognize is still reported as leaving", () => {
    const { settings, removed } = composeClaudeSettings({ mcpServers: "odd" }, MANAGED);
    expect(settings.mcpServers).toBeUndefined();
    expect(removed.find((group) => group.key === "mcpServers")?.items).toEqual([
      "(unrecognized value)",
    ]);
  });

  test("no mcpServers key means no mcpServers removal", () => {
    const { removed } = composeClaudeSettings({ model: "x" }, MANAGED);
    expect(removed.some((group) => group.key === "mcpServers")).toBe(false);
  });
});

describe("the managed keys themselves", () => {
  test("hooks, permissions and sandbox take the generated values outright", () => {
    const current: JsonObject = {
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "old" }] }] },
      permissions: { allow: ["old"], deny: ["old"], defaultMode: "acceptEdits" },
      sandbox: { enabled: false },
    };

    const { settings } = composeClaudeSettings(current, MANAGED);

    expect(settings.hooks).toEqual(MANAGED.hooks);
    expect(settings.sandbox).toEqual(MANAGED.sandbox);
    expect(settings.permissions).toEqual({
      allow: ["Bash(git commit *)"],
      deny: ["Bash(shutdown *)"],
      defaultMode: "auto",
    });
  });
});

describe("idempotence", () => {
  test("composing the composed output again changes nothing", () => {
    const current: JsonObject = {
      env: { YOKI_ROOT: "/yoki", GOPATH: "/go" },
      model: "x",
      hooks: { Notification: [{ hooks: [{ type: "command", command: "beep" }] }] },
      permissions: { allow: ["Edit(./**)"], deny: [], defaultMode: "acceptEdits" },
      mcpServers: { "figma-desktop": {} },
    };

    const once = composeClaudeSettings(current, MANAGED);
    const twice = composeClaudeSettings(once.settings, MANAGED);

    expect(renderClaudeSettings(twice.settings)).toBe(renderClaudeSettings(once.settings));
    // Second pass has nothing left to take away — the cleanup is one-time.
    expect(twice.removed).toEqual([]);
  });
});

describe("rendering", () => {
  test("two-space JSON with one trailing newline, matching the file Claude Code writes", () => {
    const text = renderClaudeSettings({ a: 1, b: { c: 2 } });
    expect(text).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}\n');
  });
});
