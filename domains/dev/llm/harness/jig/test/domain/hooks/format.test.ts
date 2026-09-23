import { describe, expect, test } from "bun:test";
import { formatPlanFor, projectRoot } from "../../../src/domain/hooks/format";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);

describe("formatPlanFor: the project's hooks first, the table only without them", () => {
  test("a lefthook.yml project: lefthook on that one file, relative to the config's root", () => {
    expect(
      formatPlanFor("/repo/src/a.ts", exists(["/repo/lefthook.yml", "/repo/biome.json"])),
    ).toEqual({
      source: "project",
      bin: "lefthook",
      args: ["run", "pre-commit", "--file", "src/a.ts"],
      cwd: "/repo",
    });
  });

  test("a pre-commit project: pre-commit on that one file", () => {
    expect(
      formatPlanFor(
        "/repo/pkg/a.py",
        exists(["/repo/.pre-commit-config.yaml", "/repo/pyproject.toml"]),
      ),
    ).toEqual({
      source: "project",
      bin: "pre-commit",
      args: ["run", "--files", "pkg/a.py"],
      cwd: "/repo",
    });
  });

  test("the project's hooks apply to every extension, including ones the table has no formatter for", () => {
    expect(formatPlanFor("/repo/notes.md", exists(["/repo/lefthook.yml"]))?.source).toBe("project");
  });

  test("no hook config: the table, run from the project root", () => {
    expect(formatPlanFor("/repo/src/a.ts", exists(["/repo/biome.json"]))).toEqual({
      source: "table",
      bin: "biome",
      args: ["check", "--write", "/repo/src/a.ts"],
      cwd: "/repo",
    });
  });

  test("no hook config and nothing in the table: undefined", () => {
    expect(formatPlanFor("/repo/notes.md", exists(["/repo/package.json"]))).toBeUndefined();
  });
});

describe("the project root", () => {
  test("is found by a hook config alone", () => {
    expect(projectRoot("/repo/src", exists(["/repo/.pre-commit-config.yaml"]))).toBe("/repo");
    expect(projectRoot("/repo/src", exists(["/repo/.lefthook.yml"]))).toBe("/repo");
  });
});
