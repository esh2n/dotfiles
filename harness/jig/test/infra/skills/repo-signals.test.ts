import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRepoSignals } from "../../../src/infra/skills/repo-signals";

const roots: string[] = [];

function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "jig-signals-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("detectRepoSignals", () => {
  test("reads the extensions and filenames a directory holds", async () => {
    const root = fixture({
      "main.go": "package main",
      "go.mod": "module x",
      "docs/notes.md": "# notes",
    });

    const signals = await detectRepoSignals(root);

    expect(signals.known).toBe(true);
    expect([...signals.extensions].sort()).toEqual([".go", ".md", ".mod"]);
    expect(signals.filenames.has("go.mod")).toBe(true);
    expect(signals.filenames.has("main.go")).toBe(true);
  });

  test("lowercases both, so a glob's case cannot decide whether a language is present", async () => {
    const root = fixture({ "Main.GO": "package main", Makefile: "all:" });

    const signals = await detectRepoSignals(root);

    expect(signals.extensions.has(".go")).toBe(true);
    expect(signals.filenames.has("makefile")).toBe(true);
  });

  test("skips the directories that hold other people's languages", async () => {
    const root = fixture({
      "main.go": "package main",
      "node_modules/left-pad/index.js": "module.exports = 1",
      "vendor/other/thing.rb": "puts 1",
    });

    const signals = await detectRepoSignals(root);

    // Without this, one `npm install` makes every repository a JavaScript repository.
    expect(signals.extensions.has(".go")).toBe(true);
    expect(signals.extensions.has(".js")).toBe(false);
    expect(signals.extensions.has(".rb")).toBe(false);
  });

  test("stops at the depth cap instead of walking a deep tree", async () => {
    const root = fixture({ "a/b/c/deep.rs": "fn main() {}", "top.go": "package main" });

    const shallow = await detectRepoSignals(root, { maxDepth: 1 });
    const deep = await detectRepoSignals(root, { maxDepth: 6 });

    expect(shallow.extensions.has(".go")).toBe(true);
    expect(shallow.extensions.has(".rs")).toBe(false);
    expect(deep.extensions.has(".rs")).toBe(true);
  });

  test("stops at the file cap", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) files[`f${index}.go`] = "package main";
    const root = fixture(files);

    const signals = await detectRepoSignals(root, { maxFiles: 3 });

    expect(signals.known).toBe(true);
    expect(signals.filenames.size).toBeLessThanOrEqual(3);
  });

  test("an empty directory is unknown, not a repository with no languages", async () => {
    // The difference matters: `known: false` keeps every path-scoped skill out of the
    // fallback, which is the right answer when nothing could be read.
    const signals = await detectRepoSignals(fixture({}));

    expect(signals.known).toBe(false);
    expect(signals.extensions.size).toBe(0);
  });

  test("a directory that does not exist is unknown rather than a failure", async () => {
    const signals = await detectRepoSignals(join(tmpdir(), "jig-signals-that-does-not-exist"));

    expect(signals.known).toBe(false);
  });

  test("a zero budget still answers, because the hook holds the turn open", async () => {
    const root = fixture({ "main.go": "package main" });

    const signals = await detectRepoSignals(root, { maxMs: 0 });

    expect(signals.known).toBe(false);
  });

  test("reads a checkout through git, which is how ignored files stay out", async () => {
    const root = fixture({
      "main.go": "package main",
      ".gitignore": "ignored/\n",
      "ignored/bundle.js": "1",
    });
    await Bun.$`git init -q ${root}`.quiet();
    await Bun.$`git -C ${root} add -A`.quiet();

    // The walk would skip neither `ignored/` nor a `.js` inside it; git's index does.
    const signals = await detectRepoSignals(root);

    expect(signals.known).toBe(true);
    expect(signals.extensions.has(".go")).toBe(true);
    expect(signals.extensions.has(".js")).toBe(false);
  });
});
