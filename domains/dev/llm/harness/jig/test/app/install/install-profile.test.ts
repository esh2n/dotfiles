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
  debug(): void {}
  info(_message: string, meta?: Record<string, unknown>): void {
    this.infos.push(meta);
  }
  warn(): void {}
  error(): void {}
}

describe("installProfile", () => {
  test("composes settings once and writes them to every target", async () => {
    const claude = new FakeWriter("claude");
    const codex = new FakeWriter("codex");
    const logger = new FakeLogger();

    await installProfile(
      {
        core: { hooks: { PreToolUse: [{ m: "core" }] } },
        packs: [{ name: "ts", settings: { hooks: { PostToolUse: [{ m: "ts" }] } } }],
        enabled: ["ts"],
      },
      [claude, codex],
      { logger },
    );

    const expected = {
      hooks: { PreToolUse: [{ m: "core" }], PostToolUse: [{ m: "ts" }] },
    };
    expect(claude.written).toEqual([{ settings: expected }]);
    expect(codex.written).toEqual([{ settings: expected }]);
    expect(logger.infos.map((m) => m?.target)).toEqual(["claude", "codex"]);
  });
});
