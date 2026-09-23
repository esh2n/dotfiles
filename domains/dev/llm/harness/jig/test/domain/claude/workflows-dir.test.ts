import { describe, expect, test } from "bun:test";
import { selectWorkflowEntries } from "../../../src/domain/claude/workflows-dir";

describe("selectWorkflowEntries", () => {
  test("*.js files and the lib directory get a link; anything else does not, each with why", () => {
    const selection = selectWorkflowEntries([
      { name: "review.js", state: { kind: "file" } },
      { name: "lib", state: { kind: "dir" } },
      { name: "design-review.js", state: { kind: "file" } },
      { name: "README.md", state: { kind: "file" } },
      { name: "notes", state: { kind: "dir" } },
      { name: "old.js", state: { kind: "symlink", target: "/x" } },
      { name: "weird.js", state: { kind: "dir" } },
    ]);
    expect(selection.linked).toEqual(["design-review.js", "lib", "review.js"]);
    expect(selection.excluded).toEqual([
      { name: "README.md", reason: "not a *.js workflow script" },
      { name: "notes", reason: "not a *.js workflow script" },
      { name: "old.js", reason: "a symlink, not a regular *.js file" },
      { name: "weird.js", reason: "a directory, not a *.js script" },
    ]);
  });

  test("a lib that is not a directory gets no link", () => {
    const selection = selectWorkflowEntries([{ name: "lib", state: { kind: "file" } }]);
    expect(selection.linked).toEqual([]);
    expect(selection.excluded[0]?.reason).toContain("not a directory");
  });
});
