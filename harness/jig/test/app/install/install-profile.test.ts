import { describe, expect, test } from "bun:test";
import { installProfile } from "../../../src/app/install/install-profile";
import type { ComposedProfile, Logger, TargetWriter } from "../../../src/domain/ports";

class FakeWriter implements TargetWriter {
  readonly written: ComposedProfile[] = [];
  constructor(readonly target: string) {}
  async write(profile: ComposedProfile): Promise<void> {
    this.written.push(profile);
  }
}

class FakeLogger implements Logger {
  readonly infos: Array<Record<string, unknown> | undefined> = [];
  readonly warns: Array<Record<string, unknown> | undefined> = [];
  debug(): void {}
  info(_message: string, meta?: Record<string, unknown>): void {
    this.infos.push(meta);
  }
  warn(_message: string, meta?: Record<string, unknown>): void {
    this.warns.push(meta);
  }
  error(): void {}
}

describe("installProfile", () => {
  test("composes settings once and writes them to every target", async () => {
    const claude = new FakeWriter("claude");
    const codex = new FakeWriter("codex");
    const logger = new FakeLogger();

    await installProfile(
      {
        selection: {
          core: { hooks: { PreToolUse: [{ m: "core" }] } },
          packs: [{ name: "ts", settings: { hooks: { PostToolUse: [{ m: "ts" }] } } }],
          enabled: ["ts"],
        },
        permissions: { allow: ["Bash(git status:*)"], deny: [], defaultMode: "auto" },
        mcpServers: {},
      },
      [claude, codex],
      { logger },
    );

    const expected = {
      permissions: {
        allow: ["Bash(git status:*)"],
        deny: [],
        defaultMode: "auto",
      },
      hooks: { PostToolUse: [{ m: "ts" }], PreToolUse: [{ m: "core" }] },
      mcpServers: {},
      enabledPlugins: {},
      extraKnownMarketplaces: {},
      env: {},
    };
    expect(claude.written).toEqual([{ settings: expected }]);
    expect(codex.written).toEqual([{ settings: expected }]);
    expect(logger.infos.map((m) => m?.target)).toEqual(["claude", "codex"]);
    expect(logger.warns).toEqual([]);
  });

  test("an enabled pack with no definition is reported, and the rest still installs", async () => {
    const claude = new FakeWriter("claude");
    const logger = new FakeLogger();

    await installProfile(
      {
        selection: {
          core: { env: { CORE: "1" } },
          packs: [{ name: "go", settings: { env: { GO: "1" } } }],
          enabled: ["go", "ghost"],
        },
        permissions: { allow: [], deny: [], defaultMode: "auto" },
        mcpServers: {},
      },
      [claude],
      { logger },
    );

    expect(logger.warns).toEqual([{ pack: "ghost" }]);
    expect(claude.written[0]?.settings.env).toEqual({ CORE: "1", GO: "1" });
  });
});
