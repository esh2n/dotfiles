import { describe, expect, test } from "bun:test";
import { gatePlanFor } from "../../../src/domain/hooks/gate";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);

describe("gatePlanFor: the project's hooks on the touched files, the table only without them", () => {
  const lefthook = exists([
    "/repo/lefthook.yml",
    "/repo/tsconfig.json",
    "/repo/src/a.ts",
    "/repo/b.md",
  ]);

  test("a lefthook project runs lefthook on the changed files, not the table's tsc", () => {
    expect(gatePlanFor("/repo", lefthook, ["src/a.ts", "b.md"])).toEqual({
      kind: "run",
      source: "project",
      tool: "lefthook",
      cwd: "/repo",
      label: "lefthook run pre-commit (2 files)",
      bin: "lefthook",
      args: ["run", "pre-commit", "--file", "src/a.ts", "--file", "b.md"],
    });
  });

  test("a pre-commit project passes every file after one --files", () => {
    const plan = gatePlanFor(
      "/repo",
      exists(["/repo/.pre-commit-config.yaml", "/repo/x.py", "/repo/y.py"]),
      ["x.py", "y.py"],
    );
    expect(plan.kind === "run" && plan.args).toEqual(["run", "--files", "x.py", "y.py"]);
  });

  test("duplicates and files that no longer exist are dropped", () => {
    const plan = gatePlanFor("/repo", lefthook, ["src/a.ts", "src/a.ts", "gone.ts", ""]);
    expect(plan.kind === "run" && plan.args).toEqual(["run", "pre-commit", "--file", "src/a.ts"]);
  });

  test("git absent: nothing runs, and the reason says so — never the table", () => {
    expect(gatePlanFor("/repo", lefthook, undefined)).toEqual({
      kind: "nothing",
      reason: "no-git",
    });
  });

  test("nothing changed: nothing runs", () => {
    expect(gatePlanFor("/repo", lefthook, [])).toEqual({ kind: "nothing", reason: "no-changes" });
    expect(gatePlanFor("/repo", lefthook, ["gone.ts"])).toEqual({
      kind: "nothing",
      reason: "no-changes",
    });
  });

  test("the config is found above the cwd, and the run happens in its directory", () => {
    const plan = gatePlanFor(
      "/repo/packages/a",
      exists(["/repo/packages/a/package.json", "/repo/lefthook.yml", "/repo/packages/a/x.ts"]),
      ["packages/a/x.ts"],
    );
    expect(plan.kind === "run" && plan.cwd).toBe("/repo");
  });

  test("no hook config: the table, in the cwd", () => {
    expect(gatePlanFor("/repo", exists(["/repo/tsconfig.json"]), undefined)).toEqual({
      kind: "run",
      source: "table",
      cwd: "/repo",
      label: "bunx tsc --noEmit",
      bin: "bunx",
      args: ["tsc", "--noEmit"],
    });
  });

  test("no hook config and no marker: no check", () => {
    expect(gatePlanFor("/repo", exists(["/repo/README.md"]), undefined)).toEqual({
      kind: "nothing",
      reason: "no-check",
    });
  });
});
