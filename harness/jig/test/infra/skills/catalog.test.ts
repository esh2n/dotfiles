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

  test("offers a hidden skill when asked to, which is what arm B' needs", () => {
    // `jig skills hide` sets the field on every routable skill; reading the farm the default
    // way after that returns nothing, and the router would have no catalog to choose from.
    const front = FRONT("name: hidden\ndescription: not listed\ndisable-model-invocation: true");

    expect(parseSkillFile(front, "/skills/hidden/SKILL.md", { includeHidden: true })).toEqual({
      name: "hidden",
      description: "not listed",
      path: "/skills/hidden/SKILL.md",
    });
    expect(parseSkillFile(front, "/skills/hidden/SKILL.md")).toBeUndefined();
  });

  test("reads paths as a YAML list", () => {
    const candidate = parseSkillFile(
      FRONT('name: go\ndescription: Go idioms\npaths:\n  - "**/*.go"\n  - "**/go.mod"'),
      "/skills/go/SKILL.md",
    );
    expect(candidate?.paths).toEqual(["**/*.go", "**/go.mod"]);
  });

  test("reads paths as a comma-separated string, quoted or not", () => {
    const quoted = parseSkillFile(
      FRONT('name: react\ndescription: React\npaths: "**/*.tsx", "**/*.jsx"'),
      "/skills/react/SKILL.md",
    );
    const bare = parseSkillFile(
      FRONT("name: react\ndescription: React\npaths: **/*.tsx, **/*.jsx"),
      "/skills/react/SKILL.md",
    );
    const flow = parseSkillFile(
      FRONT('name: react\ndescription: React\npaths: ["**/*.tsx", "**/*.jsx"]'),
      "/skills/react/SKILL.md",
    );

    // The quoted comma form is the one a scalar parser mangles: it looks like one quoted
    // string whose first and last characters are quotes.
    expect(quoted?.paths).toEqual(["**/*.tsx", "**/*.jsx"]);
    expect(bare?.paths).toEqual(["**/*.tsx", "**/*.jsx"]);
    expect(flow?.paths).toEqual(["**/*.tsx", "**/*.jsx"]);
  });

  test("a skill with no paths carries none, which is not an empty list", () => {
    const candidate = parseSkillFile(
      FRONT("name: writeup\ndescription: documents that are kept"),
      "/skills/writeup/SKILL.md",
    );
    // `undefined` means "applies anywhere"; `[]` would mean "applies nowhere".
    expect(candidate?.paths).toBeUndefined();
    expect("paths" in (candidate ?? {})).toBe(false);
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

  test("a farm whose skills are all hidden reads empty, or whole with includeHidden", async () => {
    const root = mkdtempSync(join(tmpdir(), "jig-catalog-"));
    try {
      mkdirSync(join(root, "writeup"));
      writeFileSync(
        join(root, "writeup", "SKILL.md"),
        FRONT("name: writeup\ndescription: documents\ndisable-model-invocation: true"),
      );

      expect(await readSkillCatalog(root)).toEqual([]);
      expect((await readSkillCatalog(root, { includeHidden: true })).map((s) => s.name)).toEqual([
        "writeup",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unreadable root is an empty catalog, not a failure", async () => {
    expect(await readSkillCatalog(join(tmpdir(), "jig-catalog-that-does-not-exist"))).toEqual([]);
  });
});
