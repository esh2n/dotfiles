import { describe, expect, test } from "bun:test";
import { judge } from "../../../src/domain/hooks/decision";
import { fanOut, patchOperations } from "../../../src/domain/policy/apply-patch";
import { parsePolicy } from "../../../src/domain/policy/parse";

const PATCH = [
  "*** Begin Patch",
  "*** Add File: src/new.ts",
  "+export const x = 1;",
  "*** Update File: src/old.ts",
  "@@",
  "-a",
  "+b",
  "*** Update File: src/renamed-from.ts",
  "*** Move to: src/renamed-to.ts",
  "*** Delete File: src/gone.ts",
  "*** End Patch",
].join("\n");

describe("apply_patch fan-out", () => {
  test("reads every file header, hunks ignored", () => {
    expect(patchOperations(PATCH)).toEqual([
      { kind: "add", path: "src/new.ts" },
      { kind: "update", path: "src/old.ts" },
      { kind: "move", path: "src/renamed-from.ts", to: "src/renamed-to.ts" },
      { kind: "delete", path: "src/gone.ts" },
    ]);
  });

  test("becomes Write/Edit calls in the shared vocabulary", () => {
    expect(fanOut(PATCH).map((c) => `${c.tool} ${c.input.file_path}`)).toEqual([
      "Write src/new.ts",
      "Edit src/old.ts",
      "Edit src/renamed-from.ts",
      "Write src/renamed-to.ts",
      "Write src/gone.ts",
    ]);
  });

  test("text that is not a patch yields nothing", () => {
    expect(patchOperations("hello")).toEqual([]);
  });
});

describe("judge on apply_patch", () => {
  const policy = parsePolicy({
    version: 2,
    floor: [
      {
        id: "floor-git-hooks",
        action: "fs.write",
        subject: { path: "(^|/)\\.git/hooks/" },
        why: "git hooks",
      },
    ],
    rules: [
      {
        id: "ask-lock",
        effect: "ask",
        action: "fs.edit",
        subject: { path: "package-lock\\.json$" },
        why: "lock file",
        profiles: ["standard"],
      },
    ],
  });
  const codex = { harness: "codex", profile: "standard" as const };
  const call = (patch: string) => ({ tool: "apply_patch", input: { command: patch } });

  test("a benign patch is allowed", () => {
    expect(judge(call(PATCH), codex, policy).decision.kind).toBe("allow");
  });

  test("the strictest file wins: a hook write inside a large patch denies the whole patch", () => {
    const j = judge(call(`${PATCH}\n*** Add File: .git/hooks/pre-commit\n+exit 0`), codex, policy);
    expect(j.decision).toEqual({ kind: "deny", reason: "git hooks" });
    expect(j.subject).toContain(".git/hooks/pre-commit");
    expect(j.subject).toContain("src/new.ts");
  });

  test("an ask on one file asks for the patch", () => {
    const j = judge(
      call("*** Begin Patch\n*** Update File: package-lock.json\n*** End Patch"),
      codex,
      policy,
    );
    expect(j.decision.kind).toBe("ask");
  });

  test("a patch with no file headers is out of scope", () => {
    expect(judge(call("*** Begin Patch\n*** End Patch"), codex, policy).source).toBe(
      "out-of-scope",
    );
  });
});
