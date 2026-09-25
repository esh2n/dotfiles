import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillRootPorts } from "../../src/app/skills/toggle-invocation";
import { skillsCli } from "../../src/cli/skills";

const roots: string[] = [];

/** The real filesystem ports, so the fixtures exercise what `jig skills` actually runs. */
const ports: SkillRootPorts = {
  listEntries: async (root) => {
    try {
      return await readdir(root);
    } catch {
      return [];
    }
  },
  readFile: async (path) => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return undefined;
    }
  },
  writeFile: (path, text) => writeFile(path, text, "utf8"),
  join: (...parts) => join(...parts),
};

function root(skills: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "jig-skills-"));
  roots.push(dir);
  for (const [name, front] of Object.entries(skills)) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "SKILL.md"), `---\n${front}\n---\n\n# ${name}\n`);
  }
  return dir;
}

const read = (dir: string, name: string) => readFileSync(join(dir, name, "SKILL.md"), "utf8");

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("jig skills hide", () => {
  test("names what it would change and writes nothing", async () => {
    const dir = root({
      writeup: "name: writeup\ndescription: documents",
      "ui-capture": "name: ui-capture\ndescription: screenshots",
    });

    const result = await skillsCli(["hide"], ports, dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("would hide 2 skill(s):");
    expect(result.stdout).toContain("  - ui-capture");
    expect(result.stdout).toContain("  - writeup");
    expect(result.stdout).toContain("dry run: nothing written. Re-run with --write to apply.");
    expect(read(dir, "writeup")).not.toContain("disable-model-invocation");
  });

  test("--write sets the key on every routable skill", async () => {
    const dir = root({
      writeup: "name: writeup\ndescription: documents",
      "ui-capture": "name: ui-capture\ndescription: screenshots",
    });

    const result = await skillsCli(["hide", "--write"], ports, dir);

    expect(result.stdout).toContain("hid 2 skill(s):");
    expect(read(dir, "writeup")).toContain("disable-model-invocation: true");
    expect(read(dir, "ui-capture")).toContain("disable-model-invocation: true");
  });

  test("refuses a skill that sets user-invocable and says so", async () => {
    const dir = root({
      writeup: "name: writeup\ndescription: documents",
      "writeup-kit": "name: writeup-kit\ndescription: shared kit\nuser-invocable: false",
    });

    const result = await skillsCli(["hide", "--write"], ports, dir);

    expect(result.stdout).toContain("hid 1 skill(s):");
    expect(result.stdout).toContain("left alone (1):");
    expect(result.stdout).toContain("writeup-kit — sets user-invocable");
    expect(read(dir, "writeup-kit")).not.toContain("disable-model-invocation");
  });

  test("is idempotent: a second run has nothing to do", async () => {
    const dir = root({ writeup: "name: writeup\ndescription: documents" });

    await skillsCli(["hide", "--write"], ports, dir);
    const again = await skillsCli(["hide", "--write"], ports, dir);

    expect(again.stdout).toContain("nothing to hide: 1 skill(s) already in that state.");
  });

  test("skips an entry that is not a skill", async () => {
    const dir = root({ writeup: "name: writeup\ndescription: documents" });
    mkdirSync(join(dir, "not-a-skill"));

    const result = await skillsCli(["hide"], ports, dir);

    expect(result.stdout).toContain("would hide 1 skill(s):");
  });
});

describe("jig skills show", () => {
  test("removes the key and restores the file byte for byte", async () => {
    const dir = root({ writeup: "name: writeup\ndescription: documents" });
    const before = read(dir, "writeup");

    await skillsCli(["hide", "--write"], ports, dir);
    const result = await skillsCli(["show", "--write"], ports, dir);

    expect(result.stdout).toContain("showed 1 skill(s):");
    expect(read(dir, "writeup")).toBe(before);
  });

  test("warns that it cannot tell whose hiding it is undoing", async () => {
    const dir = root({ secret: "name: secret\ndescription: x\ndisable-model-invocation: true" });

    const result = await skillsCli(["show"], ports, dir);

    expect(result.stdout).toContain("would show 1 skill(s):");
    expect(result.stdout).toContain("a skill its author hid looks exactly like one jig hid.");
  });
});

describe("jig skills argv", () => {
  test("--root overrides the default root", async () => {
    const dir = root({ writeup: "name: writeup\ndescription: documents" });

    const result = await skillsCli(["hide", "--root", dir], ports, "/nowhere");

    expect(result.stdout).toContain(`root: ${dir}`);
    expect(result.stdout).toContain("would hide 1 skill(s):");
  });

  test("an unknown subcommand or flag is a usage error, not a write", async () => {
    expect((await skillsCli([], ports, "/nowhere")).code).toBe(2);
    expect((await skillsCli(["toggle"], ports, "/nowhere")).code).toBe(2);
    const flag = await skillsCli(["hide", "--force"], ports, "/nowhere");
    expect(flag.code).toBe(2);
    expect(flag.stdout).toContain("usage: jig skills <hide|show> [--write] [--root <dir>]");
  });

  test("an unreadable root is an empty plan, not a failure", async () => {
    const result = await skillsCli(["hide"], ports, join(tmpdir(), "jig-skills-does-not-exist"));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("nothing to hide");
  });
});
