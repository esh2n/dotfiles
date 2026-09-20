import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { registerCodex } from "../../../src/app/codex/register-codex";

class FakeFs {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  async readFile(path: string): Promise<string | undefined> {
    return this.files.get(path);
  }
  async writeAtomic(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.writes.push(path);
  }
  sha256(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }
}

const paths = { hooksJson: "/h/hooks.json", configToml: "/h/config.toml" };
const input = {
  command: "'/u/bun' '/u/jig.ts' hooks pre-tool-use --harness codex",
  matcher: "Bash",
  timeoutSeconds: 10,
};

describe("registerCodex", () => {
  test("dry run plans both files and writes nothing", async () => {
    const fs = new FakeFs();
    const result = await registerCodex(fs, paths, input, { write: false });
    expect(result.written).toBe(false);
    expect(fs.writes).toEqual([]);
    expect(result.key).toBe("/h/hooks.json:pre_tool_use:0:0");
    expect(result.configToml).toContain(`[hooks.state."${result.key}"]`);
    expect(result.configToml).toContain(`trusted_hash = "sha256:${result.hash}"`);
  });

  test("write puts the trust entry for exactly the handler as written", async () => {
    const fs = new FakeFs();
    fs.files.set(paths.configToml, "# yoki:begin\n[features]\nhooks = true\n# yoki:end\n");
    const result = await registerCodex(fs, paths, input, { write: true });
    expect(result.written).toBe(true);
    expect(fs.writes).toEqual([paths.hooksJson, paths.configToml]);
    const doc = JSON.parse(fs.files.get(paths.hooksJson) ?? "") as {
      hooks: {
        PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string; timeout: number }> }>;
      };
    };
    const handler = doc.hooks.PreToolUse[0]?.hooks[0];
    const identity = `{"event_name":"pre_tool_use","hooks":[{"async":false,"command":${JSON.stringify(handler?.command)},"timeout":${handler?.timeout},"type":"command"}],"matcher":"Bash"}`;
    expect(result.hash).toBe(fs.sha256(identity));
    expect(fs.files.get(paths.configToml)).toContain("# yoki:end\n\n# jig:begin hooks");
    // Second run: nothing to do.
    const again = await registerCodex(fs, paths, input, { write: true });
    expect(again.written).toBe(false);
  });

  test("refuses when another tool already declares the same key", async () => {
    const fs = new FakeFs();
    fs.files.set(
      paths.configToml,
      `[hooks.state."/h/hooks.json:pre_tool_use:0:0"]\ntrusted_hash = "sha256:x"\nenabled = true\n`,
    );
    await expect(registerCodex(fs, paths, input, { write: true })).rejects.toThrow(
      /another tool owns that slot/,
    );
    expect(fs.writes).toEqual([]);
  });

  test("a TOML validator can veto the write", async () => {
    const fs = new FakeFs();
    await expect(
      registerCodex(fs, paths, input, {
        write: true,
        validateToml: () => {
          throw new Error("bad toml");
        },
      }),
    ).rejects.toThrow(/bad toml/);
    expect(fs.writes).toEqual([]);
  });
});
