import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeApplyFs } from "../../../src/infra/apply/node-apply-fs";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jig-apply-fs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createNodeApplyFs", () => {
  test("readFile returns undefined for a missing file", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    expect(await fs.readFile(join(dir, "nope.txt"))).toBeUndefined();
  });

  test("writeAtomic creates parent directories and leaves no stage file behind", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    const dest = join(dir, "nested", "deep", "file.json");

    await fs.writeAtomic(dest, "hello");

    expect(readFileSync(dest, "utf8")).toBe("hello");
    expect(existsSync(`${dest}.jig-stage`)).toBe(false);
  });

  test("readManifest returns {} when no manifest file exists yet", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    expect(await fs.readManifest()).toEqual({});
  });

  test("writeManifest then readManifest round-trips", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    await fs.writeManifest({ "/a": "hash-a", "/b": "hash-b" });
    expect(await fs.readManifest()).toEqual({ "/a": "hash-a", "/b": "hash-b" });
  });

  test("sha256 is deterministic and matches a known vector", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    // echo -n "hello" | shasum -a 256
    expect(fs.sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  test("writeProvenance writes a sidecar json file into the given directory", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.7" });
    const destDir = join(dir, "target-dir");

    await fs.writeProvenance(destDir, {
      sourceFile: "/repo/policy/tiers.json",
      sourceSha256: "abc123",
      generatedAt: "2026-09-20T00:00:00.000Z",
      jigVersion: "0.0.7",
    });

    const written = JSON.parse(readFileSync(join(destDir, ".jig-provenance.json"), "utf8"));
    expect(written).toEqual({
      sourceFile: "/repo/policy/tiers.json",
      sourceSha256: "abc123",
      generatedAt: "2026-09-20T00:00:00.000Z",
      jigVersion: "0.0.7",
    });
  });

  test("now() returns a real, recent Date", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    const before = Date.now();
    const now = fs.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before - 1000);
  });
});
