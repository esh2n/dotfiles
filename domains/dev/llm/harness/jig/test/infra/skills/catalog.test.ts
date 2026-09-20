import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFile, readSkillCatalog } from "../../../src/infra/skills/catalog";

const FRONT = (fields: string, body = "\n# Skill\n") => `---\n${fields}\n---\n${body}`;

describe("parseSkillFile", () => {
  test("reads name and description", () => {
    const candidate = parseSkillFile(
      FRONT("name: writeup\ndescription: documents that are kept"),
      "/skills/writeup/SKILL.md",
    );
    expect(candidate).toEqual({
      name: "writeup",
      description: "documents that are kept",
      path: "/skills/writeup/SKILL.md",
    });
  });

  test("skips a skill the harness does not list", () => {
    const candidate = parseSkillFile(
      FRONT("name: hidden\ndescription: not offered\ndisable-model-invocation: true"),
      "/skills/hidden/SKILL.md",
    );
    expect(candidate).toBeUndefined();
  });

  test("unwraps a quoted description and its escapes", () => {
    const candidate = parseSkillFile(
      FRONT('name: quoted\ndescription: "says \\"hi\\" and stops"'),
      "/skills/quoted/SKILL.md",
    );
    expect(candidate?.description).toBe('says "hi" and stops');
  });

  test("joins a block description instead of cutting it at the first line", () => {
    const candidate = parseSkillFile(
      FRONT("name: block\ndescription: >\n  first half\n  second half"),
      "/skills/block/SKILL.md",
    );
    expect(candidate?.description).toBe("first half second half");
  });

  test("no candidate without frontmatter or a description", () => {
    expect(parseSkillFile("# just a body", "/skills/x/SKILL.md")).toBeUndefined();
    expect(parseSkillFile(FRONT("name: bare"), "/skills/bare/SKILL.md")).toBeUndefined();
  });
});

describe("readSkillCatalog", () => {
  test("reads every skill directory, in name order, skipping the ones it cannot read", async () => {
    const root = mkdtempSync(join(tmpdir(), "jig-catalog-"));
    try {
      mkdirSync(join(root, "b-skill"));
      mkdirSync(join(root, "a-skill"));
      mkdirSync(join(root, "not-a-skill"));
      writeFileSync(join(root, "b-skill", "SKILL.md"), FRONT("name: b-skill\ndescription: b"));
      writeFileSync(join(root, "a-skill", "SKILL.md"), FRONT("name: a-skill\ndescription: a"));
      writeFileSync(
        join(root, "not-a-skill", "README.md"),
        "no SKILL.md here, and reading one must not throw",
      );

      const catalog = await readSkillCatalog(root);

      expect(catalog.map((candidate) => candidate.name)).toEqual(["a-skill", "b-skill"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unreadable root is an empty catalog, not a failure", async () => {
    expect(await readSkillCatalog(join(tmpdir(), "jig-catalog-that-does-not-exist"))).toEqual([]);
  });
});
