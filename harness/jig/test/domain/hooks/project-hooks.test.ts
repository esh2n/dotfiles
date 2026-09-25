import { describe, expect, test } from "bun:test";
import {
  missingToolReason,
  projectHookCommand,
  projectHooksFor,
} from "../../../src/domain/hooks/project-hooks";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);

describe("which hook config a project has", () => {
  test("lefthook.yml, .lefthook.yml and .pre-commit-config.yaml, from the nearest ancestor", () => {
    expect(projectHooksFor("/repo/src/deep", exists(["/repo/lefthook.yml"]))).toEqual({
      tool: "lefthook",
      root: "/repo",
      config: "lefthook.yml",
    });
    expect(projectHooksFor("/repo", exists(["/repo/.lefthook.yml"]))?.tool).toBe("lefthook");
    expect(projectHooksFor("/repo", exists(["/repo/.pre-commit-config.yaml"]))).toEqual({
      tool: "pre-commit",
      root: "/repo",
      config: ".pre-commit-config.yaml",
    });
  });

  test("lefthook wins when a root carries both", () => {
    expect(
      projectHooksFor("/repo", exists(["/repo/.pre-commit-config.yaml", "/repo/lefthook.yml"]))
        ?.tool,
    ).toBe("lefthook");
  });

  test("a sub-package's package.json does not hide the repository's lefthook.yml", () => {
    expect(
      projectHooksFor(
        "/repo/packages/a/src",
        exists(["/repo/packages/a/package.json", "/repo/lefthook.yml", "/repo/.git"]),
      )?.root,
    ).toBe("/repo");
  });

  test("the walk stops at the repository boundary: a config above .git is another project's", () => {
    expect(
      projectHooksFor("/home/me/repo/src", exists(["/home/me/repo/.git", "/home/me/lefthook.yml"])),
    ).toBeUndefined();
  });

  test("none, and none anywhere up to the filesystem root", () => {
    expect(projectHooksFor("/repo/src", exists(["/repo/package.json"]))).toBeUndefined();
  });
});

describe("the command each tool documents", () => {
  const lefthook = { tool: "lefthook", root: "/repo", config: "lefthook.yml" } as const;
  const preCommit = {
    tool: "pre-commit",
    root: "/repo",
    config: ".pre-commit-config.yaml",
  } as const;

  test("lefthook: `run pre-commit`, then `--file` repeated once per file (lefthook.dev/usage/commands/run/)", () => {
    expect(projectHookCommand(lefthook, ["src/a.ts"])).toEqual({
      label: "lefthook run pre-commit (1 file)",
      bin: "lefthook",
      args: ["run", "pre-commit", "--file", "src/a.ts"],
    });
    expect(projectHookCommand(lefthook, ["src/a.ts", "src/b.go"]).args).toEqual([
      "run",
      "pre-commit",
      "--file",
      "src/a.ts",
      "--file",
      "src/b.go",
    ]);
  });

  test("pre-commit: `run --files` followed by every path (pre-commit.com/#pre-commit-run)", () => {
    expect(projectHookCommand(preCommit, ["src/a.py"])).toEqual({
      label: "pre-commit run (1 file)",
      bin: "pre-commit",
      args: ["run", "--files", "src/a.py"],
    });
    expect(projectHookCommand(preCommit, ["src/a.py", "src/b.py"])).toEqual({
      label: "pre-commit run (2 files)",
      bin: "pre-commit",
      args: ["run", "--files", "src/a.py", "src/b.py"],
    });
  });

  test("the missing-tool line names the config, the tool, and where to install it", () => {
    const reason = missingToolReason(lefthook);
    expect(reason).not.toContain("\n");
    expect(reason).toContain("`lefthook.yml`");
    expect(reason).toContain("`lefthook` is not on PATH");
    expect(reason).toContain("https://lefthook.dev/installation/");
    expect(missingToolReason(preCommit)).toContain("https://pre-commit.com/#install");
  });
});
