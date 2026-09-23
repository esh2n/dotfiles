import { describe, expect, test } from "bun:test";
import type { RetirePaths } from "../../src/app/retire/retire-yoki";
import { formatRetire, retireCli } from "../../src/cli/retire";
import { fakeRetireFs } from "../app/retire/fake-retire-ports";

const CLAUDE = "/home/u/.claude";
const CODEX = "/home/u/.codex";
const PROFILES = "/repo/claude-profiles";

const PATHS: RetirePaths = {
  claudeDir: CLAUDE,
  codexHome: CODEX,
  ompAgentDir: "/home/u/.omp/agent",
  cursorRules: "/home/u/.cursor/rules",
  claudeProfilesRoot: PROFILES,
  ompRepoExtensions: "/repo/omp/extensions",
};

function machine() {
  return fakeRetireFs({
    files: {
      [`${CLAUDE}/.claude-packs`]: "go\n",
      [`${CLAUDE}/.agents-merged/mine.md`]: "mine",
      [`${CODEX}/config.toml`]:
        '# yoki:begin\n[features]\nhooks = true\n# yoki:end\n\n[projects."/r"]\ntrust_level = "trusted"\n',
    },
    links: {
      [`${CLAUDE}/hooks`]: `${CLAUDE}/.hooks-merged`,
      [`${CLAUDE}/.hooks-merged/g.sh`]: `${PROFILES}/personal/hooks/g.sh`,
    },
  });
}

describe("jig retire", () => {
  test("wants the subject `yoki` and only --write", async () => {
    const fs = machine();
    expect((await retireCli([], fs.retire, PATHS)).code).toBe(2);
    expect((await retireCli(["jig"], fs.retire, PATHS)).code).toBe(2);
    const bad = await retireCli(["yoki", "--force"], fs.retire, PATHS);
    expect(bad.code).toBe(2);
    expect(bad.stdout).toContain('unknown argument "--force"');
    expect(fs.log).toEqual([]);
  });

  test("the dry-run names each item with its action, what it is, the evidence, and the skip reason", async () => {
    const fs = machine();
    const result = await retireCli(["yoki"], fs.retire, PATHS);
    expect(result.code).toBe(0);
    expect(fs.log).toEqual([]);
    const out = result.stdout;
    expect(out).toContain("== retire yoki ==\nmode: dry-run\n");
    expect(out).toMatch(/^removals: 4 {2}skipped: 1 {2}absent: \d+$/m);
    expect(out).toContain("Claude Code (4 found, 6 absent):");
    expect(out).toMatch(/^ {2}remove link {1}\/home\/u\/\.claude\/hooks/m);
    expect(out).toContain("    evidence: a symlink into .hooks-merged");
    expect(out).toMatch(/^ {2}SKIP {8}\/home\/u\/\.claude\/\.agents-merged/m);
    expect(out).toContain("    skipped:  holds 1 non-symlink entry (mine.md)");
    expect(out).toMatch(/^ {2}remove dir {2}\/home\/u\/\.claude\/\.hooks-merged/m);
    expect(out).toMatch(/^ {2}remove file \/home\/u\/\.claude\/\.claude-packs/m);
    expect(out).toContain("Codex (1 found, 3 absent):");
    expect(out).toMatch(/^ {2}rewrite {5}\/home\/u\/\.codex\/config\.toml/m);
    expect(out).toContain("    backup:   /home/u/.codex/config.toml.pre-retire.20260923-000000");
    expect(out).toContain(
      "    - # yoki:begin … # yoki:end block (3 lines): [features] (kept, lifted out)",
    );
    expect(out).toContain("    + [features] lifted out of the block and kept");
    expect(out).toContain("omp (0 found, 5 absent):\n  (nothing of yoki's found)");
    expect(out).toContain("Cursor (0 found):");
    expect(out).toContain("never touched: ~/.claude.json, ~/.claude/settings.json");
    expect(out).toContain("dry run: nothing removed. Re-run with --write");
  });

  test("--write reports the mode and exits 0 when every removal went through", async () => {
    const fs = machine();
    const result = await retireCli(["yoki", "--write"], fs.retire, PATHS);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("mode: write\n");
    expect(result.stdout).not.toContain("dry run:");
    expect(fs.files[`${CLAUDE}/.claude-packs`]).toBeUndefined();
    expect(fs.files[`${CLAUDE}/.agents-merged/mine.md`]).toBe("mine");
    expect(fs.files[`${CODEX}/config.toml`]).toBe(
      '[features]\nhooks = true\n\n[projects."/r"]\ntrust_level = "trusted"\n',
    );
  });

  test("a failed removal is listed and the exit code is 1", async () => {
    const fs = machine();
    const failing = {
      ...fs.retire,
      removeFile: async (path: string) => {
        throw new Error(`EACCES ${path}`);
      },
    };
    const result = await retireCli(["yoki", "--write"], failing, PATHS);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("FAILED (1):\n  /home/u/.claude/.claude-packs: EACCES");
  });

  test("a TOML validator reaches the use-case", async () => {
    const fs = machine();
    const result = await retireCli(["yoki"], fs.retire, PATHS, {
      validateToml: () => {
        throw new Error("bad toml");
      },
    });
    expect(result.stdout).toContain("skipped:  not safely editable: bad toml");
  });

  test("formatRetire says when --write found nothing", () => {
    const out = formatRetire({
      groups: [],
      write: true,
      wrote: false,
      counts: { removals: 0, skipped: 0, absent: 0 },
      failures: [],
    });
    expect(out).toContain("mode: write (nothing to remove)");
  });
});
