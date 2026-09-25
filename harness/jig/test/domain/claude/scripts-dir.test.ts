import { describe, expect, test } from "bun:test";
import { selectScriptFiles } from "../../../src/domain/claude/scripts-dir";

describe("selectScriptFiles", () => {
  test("regular files get a link, sorted; README, directories and symlinks do not, each with why", () => {
    const selection = selectScriptFiles([
      { name: "statusline.sh", state: { kind: "file" } },
      { name: "README.md", state: { kind: "file" } },
      { name: "correction-distill.sh", state: { kind: "file" } },
      { name: "lib", state: { kind: "dir" } },
      { name: "old.sh", state: { kind: "symlink", target: "/x" } },
      { name: "gone.sh", state: { kind: "missing" } },
    ]);
    expect(selection.linked).toEqual(["correction-distill.sh", "statusline.sh"]);
    expect(selection.excluded).toEqual([
      { name: "README.md", reason: "the directory's README, not a script" },
      { name: "gone.sh", reason: "vanished between listing and inspection" },
      { name: "lib", reason: "a directory, not a script file" },
      { name: "old.sh", reason: "a symlink, not a regular file" },
    ]);
  });

  test("an empty source selects nothing", () => {
    expect(selectScriptFiles([])).toEqual({ linked: [], excluded: [] });
  });
});
