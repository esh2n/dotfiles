import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

describe("the symlink verbs", () => {
  test("inspect tells the four states apart and never follows a link", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    writeFileSync(join(dir, "file"), "x");
    mkdirSync(join(dir, "real"));
    symlinkSync("AGENTS.md", join(dir, "rel"));
    symlinkSync(join(dir, "real"), join(dir, "abs"));
    symlinkSync(join(dir, "gone"), join(dir, "dangling"));

    expect(await fs.inspect(join(dir, "nope"))).toEqual({ kind: "missing" });
    expect(await fs.inspect(join(dir, "file"))).toEqual({ kind: "file" });
    expect(await fs.inspect(join(dir, "real"))).toEqual({ kind: "dir" });
    // A link to a directory is a symlink, not a dir, and the target is verbatim.
    expect(await fs.inspect(join(dir, "abs"))).toEqual({
      kind: "symlink",
      target: join(dir, "real"),
    });
    expect(await fs.inspect(join(dir, "rel"))).toEqual({ kind: "symlink", target: "AGENTS.md" });
    expect(await fs.inspect(join(dir, "dangling"))).toEqual({
      kind: "symlink",
      target: join(dir, "gone"),
    });
  });

  test("symlink stores a relative target as given", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    await fs.symlink("AGENTS.md", join(dir, "CLAUDE.md"));
    expect(readlinkSync(join(dir, "CLAUDE.md"))).toBe("AGENTS.md");
  });

  test("symlink refuses an occupied path — the domain plans the removal or backup first", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    writeFileSync(join(dir, "taken"), "x");
    expect(fs.symlink("/elsewhere", join(dir, "taken"))).rejects.toThrow();
  });

  test("remove on a symlink to a directory unlinks the link and leaves the directory", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    mkdirSync(join(dir, "staging"));
    writeFileSync(join(dir, "staging", "keep.md"), "kept");
    symlinkSync(join(dir, "staging"), join(dir, "link"));

    await fs.remove(join(dir, "link"));

    expect(existsSync(join(dir, "link"))).toBe(false);
    expect(readFileSync(join(dir, "staging", "keep.md"), "utf8")).toBe("kept");
  });

  test("remove on a real directory removes the tree", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    mkdirSync(join(dir, "tree", "deep"), { recursive: true });
    symlinkSync("/nowhere", join(dir, "tree", "deep", "l"));
    await fs.remove(join(dir, "tree"));
    expect(existsSync(join(dir, "tree"))).toBe(false);
  });

  test("rename moves a file, a directory, or a link as-is", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    writeFileSync(join(dir, "CLAUDE.md"), "hand-written");
    await fs.rename(join(dir, "CLAUDE.md"), join(dir, "CLAUDE.md.pre-jig.20260923-000000"));
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(readFileSync(join(dir, "CLAUDE.md.pre-jig.20260923-000000"), "utf8")).toBe(
      "hand-written",
    );
  });

  test("mkdir creates parents and tolerates an existing directory", async () => {
    const fs = createNodeApplyFs({ stateDir: join(dir, "state"), jigVersion: "0.0.0" });
    await fs.mkdir(join(dir, "a", "b"));
    await fs.mkdir(join(dir, "a", "b"));
    expect(lstatSync(join(dir, "a", "b")).isDirectory()).toBe(true);
  });
});
