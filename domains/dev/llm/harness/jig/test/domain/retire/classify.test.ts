import { describe, expect, test } from "bun:test";
import {
  KNOWN_CMD_SKILLS,
  classifyCmdSkillDir,
  classifyCursorRules,
  classifyLinkInto,
  classifyMergedDir,
  classifyStateDir,
  classifyYokiFile,
  parseCodexManifest,
} from "../../../src/domain/retire/classify";

const CLAUDE = "/home/u/.claude";
const PROFILES = "/repo/domains/dev/config/claude-profiles";

describe("a .<x>-merged staging directory", () => {
  test("goes when it holds only symlinks and nothing links to it any more", () => {
    const item = classifyMergedDir({
      claudeDir: CLAUDE,
      name: "agents",
      state: { kind: "dir" },
      entries: [
        { name: "a.md", state: { kind: "symlink", target: `${PROFILES}/core/agents/a.md` } },
        { name: "b.md", state: { kind: "symlink", target: `${PROFILES}/core/agents/b.md` } },
      ],
      liveState: { kind: "dir" },
    });
    expect(item.path).toBe(`${CLAUDE}/.agents-merged`);
    expect(item.action).toEqual({ kind: "remove-tree" });
  });

  test("an empty one goes too", () => {
    const item = classifyMergedDir({
      claudeDir: CLAUDE,
      name: "commands",
      state: { kind: "dir" },
      entries: [],
      liveState: { kind: "missing" },
    });
    expect(item.action).toEqual({ kind: "remove-tree" });
  });

  test("a regular file or a real directory inside stops it, and the names are said", () => {
    const item = classifyMergedDir({
      claudeDir: CLAUDE,
      name: "skills",
      state: { kind: "dir" },
      entries: [
        { name: "writeup", state: { kind: "symlink", target: `${PROFILES}/core/skills/writeup` } },
        { name: "synced", state: { kind: "dir" } },
        { name: "notes.txt", state: { kind: "file" } },
      ],
      liveState: { kind: "dir" },
    });
    expect(item.action.kind).toBe("skip");
    if (item.action.kind === "skip") {
      expect(item.action.reason).toContain("2 non-symlink entries (notes.txt, synced)");
    }
  });

  test("is skipped while ~/.claude/<x> still links to it, naming the apply that replaces the link", () => {
    const item = classifyMergedDir({
      claudeDir: CLAUDE,
      name: "scripts",
      state: { kind: "dir" },
      entries: [{ name: "s.sh", state: { kind: "symlink", target: "/x/s.sh" } }],
      liveState: { kind: "symlink", target: `${CLAUDE}/.scripts-merged` },
    });
    expect(item.action.kind).toBe("skip");
    if (item.action.kind === "skip") {
      expect(item.action.reason).toContain("jig apply --target claude --write");
    }
  });

  test("hooks is the exception: retire removes that link itself, so its staging dir is not held back", () => {
    const item = classifyMergedDir({
      claudeDir: CLAUDE,
      name: "hooks",
      state: { kind: "dir" },
      entries: [{ name: "g.sh", state: { kind: "symlink", target: "/x/g.sh" } }],
      liveState: { kind: "symlink", target: `${CLAUDE}/.hooks-merged` },
    });
    expect(item.action).toEqual({ kind: "remove-tree" });
  });

  test("a symlink or a file at the staging path is a mismatch, and absent is absent", () => {
    const link = classifyMergedDir({
      claudeDir: CLAUDE,
      name: "rules",
      state: { kind: "symlink", target: "/elsewhere" },
      entries: [],
      liveState: { kind: "dir" },
    });
    expect(link.action.kind).toBe("skip");
    const none = classifyMergedDir({
      claudeDir: CLAUDE,
      name: "rules",
      state: { kind: "missing" },
      entries: [],
      liveState: { kind: "dir" },
    });
    expect(none.action).toEqual({ kind: "absent" });
  });
});

describe("state directories and files known by name", () => {
  test(".yoki/ goes as a tree; anything else at the path is a mismatch", () => {
    expect(classifyStateDir("codex", "/h/.yoki", { kind: "dir" }, "x").action).toEqual({
      kind: "remove-tree",
    });
    expect(classifyStateDir("codex", "/h/.yoki", { kind: "file" }, "x").action.kind).toBe("skip");
    expect(classifyStateDir("codex", "/h/.yoki", { kind: "missing" }, "x").action.kind).toBe(
      "absent",
    );
  });

  test("a file by name goes; a directory or link where the file should be does not", () => {
    const base = { harness: "claude" as const, path: `${CLAUDE}/.claude-packs`, what: "packs" };
    expect(classifyYokiFile({ ...base, state: { kind: "file" } }).action).toEqual({
      kind: "remove-file",
    });
    expect(classifyYokiFile({ ...base, state: { kind: "dir" } }).action.kind).toBe("skip");
    expect(
      classifyYokiFile({ ...base, state: { kind: "symlink", target: "/x" } }).action.kind,
    ).toBe("skip");
  });

  test("a file with a required header is yoki's only when the header is there", () => {
    const base = {
      harness: "omp" as const,
      path: "/o/RULES.md",
      what: "rules",
      state: { kind: "file" as const },
    };
    const marked = classifyYokiFile({
      ...base,
      marker: { text: "<!-- yoki:begin -->\n# rules\n", needle: "<!-- yoki:begin -->" },
    });
    expect(marked.action).toEqual({ kind: "remove-file" });
    expect(marked.evidence).toContain("<!-- yoki:begin -->");
    const unmarked = classifyYokiFile({
      ...base,
      marker: { text: "# my own rules\n", needle: "<!-- yoki:begin -->" },
    });
    expect(unmarked.action.kind).toBe("skip");
    if (unmarked.action.kind === "skip") {
      expect(unmarked.action.reason).toContain("not recognisably yoki's");
    }
  });
});

describe("links recognised by where they point", () => {
  const base = { harness: "omp" as const, path: "/o/extensions/yoki-guard.ts", what: "ext" };
  const roots = ["/repo/domains/dev/config/omp/extensions", PROFILES];

  test("a symlink into one of the roots goes", () => {
    const item = classifyLinkInto({
      ...base,
      state: { kind: "symlink", target: "/repo/domains/dev/config/omp/extensions/yoki-guard.ts" },
      roots,
      rootsLabel: "the repo",
    });
    expect(item.action).toEqual({ kind: "remove-link" });
  });

  test("a relative target is resolved against the link's directory", () => {
    const item = classifyLinkInto({
      harness: "claude",
      path: `${CLAUDE}/hooks`,
      what: "hooks",
      state: { kind: "symlink", target: ".hooks-merged" },
      roots: [`${CLAUDE}/.hooks-merged`],
      rootsLabel: ".hooks-merged",
    });
    expect(item.action).toEqual({ kind: "remove-link" });
  });

  test("a symlink elsewhere, or a regular file, is a mismatch", () => {
    const elsewhere = classifyLinkInto({
      ...base,
      state: { kind: "symlink", target: "/home/u/mine/guard.ts" },
      roots,
      rootsLabel: "the repo",
    });
    expect(elsewhere.action.kind).toBe("skip");
    if (elsewhere.action.kind === "skip") {
      expect(elsewhere.action.reason).toContain("→ /home/u/mine/guard.ts");
    }
    const file = classifyLinkInto({ ...base, state: { kind: "file" }, roots, rootsLabel: "r" });
    expect(file.action.kind).toBe("skip");
  });
});

describe("Codex cmd-* skill directories", () => {
  const dir = "/home/u/.codex/skills/cmd-plan";
  const oneFile = [{ name: "SKILL.md", state: { kind: "file" as const } }];

  test("listed in the manifest and holding only SKILL.md: the file first, then the directory", () => {
    const items = classifyCmdSkillDir({
      path: dir,
      state: { kind: "dir" },
      entries: oneFile,
      manifestPaths: [`${dir}/SKILL.md`],
    });
    expect(items.map((item) => [item.path, item.action.kind])).toEqual([
      [`${dir}/SKILL.md`, "remove-file"],
      [dir, "remove-tree"],
    ]);
    expect(items[0]?.evidence).toContain("codex-manifest.json");
  });

  test("with no manifest, the inventory's sixteen names vouch; an unknown name does not", () => {
    expect(KNOWN_CMD_SKILLS).toHaveLength(16);
    const known = classifyCmdSkillDir({
      path: dir,
      state: { kind: "dir" },
      entries: oneFile,
      manifestPaths: undefined,
    });
    expect(known.map((item) => item.action.kind)).toEqual(["remove-file", "remove-tree"]);
    expect(known[0]?.evidence).toContain("sixteen");
    const unknown = classifyCmdSkillDir({
      path: "/home/u/.codex/skills/cmd-mine",
      state: { kind: "dir" },
      entries: oneFile,
      manifestPaths: undefined,
    });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.action.kind).toBe("skip");
  });

  test("a manifest that does not list it is not overridden by the name list", () => {
    const items = classifyCmdSkillDir({
      path: dir,
      state: { kind: "dir" },
      entries: oneFile,
      manifestPaths: ["/home/u/.codex/skills/cmd-aside/SKILL.md"],
    });
    expect(items[0]?.action.kind).toBe("skip");
    expect(items[0]?.evidence).toContain("not listed");
  });

  test("a second file beside SKILL.md, or a SKILL.md that is not a regular file, is a mismatch", () => {
    const extra = classifyCmdSkillDir({
      path: dir,
      state: { kind: "dir" },
      entries: [...oneFile, { name: "notes.md", state: { kind: "file" } }],
      manifestPaths: [`${dir}/SKILL.md`],
    });
    expect(extra[0]?.action.kind).toBe("skip");
    if (extra[0]?.action.kind === "skip") expect(extra[0].action.reason).toContain("notes.md");
    const linked = classifyCmdSkillDir({
      path: dir,
      state: { kind: "dir" },
      entries: [{ name: "SKILL.md", state: { kind: "symlink", target: "/x" } }],
      manifestPaths: [`${dir}/SKILL.md`],
    });
    expect(linked[0]?.action.kind).toBe("skip");
  });

  test("the manifest reader takes a JSON array of strings and nothing else", () => {
    expect(parseCodexManifest('["/a", "/b", 3]')).toEqual(["/a", "/b"]);
    expect(parseCodexManifest('{"a":1}')).toBeUndefined();
    expect(parseCodexManifest("not json")).toBeUndefined();
    expect(parseCodexManifest(undefined)).toBeUndefined();
  });
});

describe("Cursor rules", () => {
  test("links into yoki's .cursor/rules go, everything else is counted and left", () => {
    const yoki = `${PROFILES}/runtime/yoki/.cursor/rules`;
    const result = classifyCursorRules({
      dir: "/home/u/.cursor/rules",
      entries: [
        {
          name: "golang-testing.md",
          state: { kind: "symlink", target: `${yoki}/golang-testing.md` },
        },
        {
          name: "common-agents.md",
          state: { kind: "symlink", target: `${yoki}/common-agents.md` },
        },
        { name: "mine.mdc", state: { kind: "file" } },
        { name: "other.md", state: { kind: "symlink", target: "/somewhere/else.md" } },
      ],
      yokiCursorRules: yoki,
    });
    expect(result.items.map((item) => item.path)).toEqual([
      "/home/u/.cursor/rules/common-agents.md",
      "/home/u/.cursor/rules/golang-testing.md",
    ]);
    expect(result.items.every((item) => item.action.kind === "remove-link")).toBe(true);
    expect(result.foreign.map((entry) => entry.name)).toEqual(["mine.mdc", "other.md"]);
  });
});
