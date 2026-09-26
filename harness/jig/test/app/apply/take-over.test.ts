import { describe, expect, test } from "bun:test";
import type { ApplyPorts } from "../../../src/app/apply/ports";
import { prepareTakeOver } from "../../../src/app/apply/take-over";

function ports(files: Record<string, string>, manifest: Record<string, string>): ApplyPorts {
  return {
    readFile: async (path) => files[path],
    writeAtomic: async (path, content) => {
      files[path] = content;
    },
    sha256: (content) => `sha:${content}`,
    readManifest: async () => ({ ...manifest }),
    writeManifest: async (next) => {
      for (const key of Object.keys(manifest)) delete manifest[key];
      Object.assign(manifest, next);
    },
    writeProvenance: async () => {},
    now: () => new Date(0),
    jigVersion: "test",
  };
}

describe("prepareTakeOver", () => {
  test("copies each file aside and forgets jig's records of it, nothing else", async () => {
    const files: Record<string, string> = {
      "/c/config.toml": "old",
      "/c/config.toml.pre-dotfiles": "earlier",
    };
    const manifest: Record<string, string> = {
      "/c/config.toml": "h1",
      "/c/AGENTS.md": "h2",
      "/other": "h3",
    };
    const kept = await prepareTakeOver(ports(files, manifest), {
      files: ["/c/config.toml", "/c/AGENTS.md"],
      records: ["/c/config.toml", "/c/AGENTS.md"],
    });

    expect(kept).toEqual(["/c/config.toml.pre-dotfiles.1"]); // AGENTS.md absent: nothing to keep
    expect(files["/c/config.toml.pre-dotfiles.1"]).toBe("old");
    expect(files["/c/config.toml.pre-dotfiles"]).toBe("earlier"); // an earlier copy stays
    expect(manifest).toEqual({ "/other": "h3" });
  });
});
