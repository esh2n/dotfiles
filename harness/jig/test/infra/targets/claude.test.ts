import { describe, expect, test } from "bun:test";
import type { FileSystem } from "../../../src/domain/ports";
import { ClaudeTargetWriter } from "../../../src/infra/targets/claude";

class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, string>();
  async read(path: string): Promise<string> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`not found: ${path}`);
    return data;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

describe("ClaudeTargetWriter", () => {
  test("writes pretty settings.json into the claude dir", async () => {
    const fs = new FakeFileSystem();
    const writer = new ClaudeTargetWriter(fs, "/home/me/.claude");
    await writer.write({ settings: { env: { A: "1" } } });

    const out = fs.files.get("/home/me/.claude/settings.json");
    expect(out).toBe(`{\n  "env": {\n    "A": "1"\n  }\n}\n`);
    expect(writer.target).toBe("claude");
  });
});
