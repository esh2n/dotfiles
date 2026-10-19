import { describe, expect, test } from "bun:test";
import { mergeSelections } from "../../../src/domain/plugins/merge";

describe("mergeSelections", () => {
  test("links every source's entries, each pointing at its own tree", () => {
    const merged = mergeSelections([
      { label: "house", dir: "/h/skills", selection: { linked: ["tdd-workflow"], excluded: [] } },
      { label: "pstack", dir: "/p/skills", selection: { linked: ["arena", "tdd"], excluded: [] } },
    ]);
    expect(merged.selection.linked).toEqual(["arena", "tdd", "tdd-workflow"]);
    expect(merged.dirOf.get("tdd")).toBe("/p/skills");
    expect(merged.dirOf.get("tdd-workflow")).toBe("/h/skills");
  });

  test("the house wins a name both have, and the pack's entry is reported with the pack named", () => {
    const merged = mergeSelections([
      { label: "house", dir: "/h", selection: { linked: ["tdd"], excluded: [] } },
      { label: "pstack", dir: "/p", selection: { linked: ["tdd"], excluded: [] } },
    ]);
    expect(merged.dirOf.get("tdd")).toBe("/h");
    expect(merged.selection.excluded).toEqual([
      {
        name: "tdd",
        reason: "pstack: an entry of the same name is already linked; that one stays",
      },
    ]);
  });

  test("a pack's own exclusions carry its name", () => {
    const merged = mergeSelections([
      { label: "house", dir: "/h", selection: { linked: [], excluded: [] } },
      {
        label: "pstack",
        dir: "/p",
        selection: { linked: [], excluded: [{ name: "README.md", reason: "a file" }] },
      },
    ]);
    expect(merged.selection.excluded).toEqual([{ name: "README.md", reason: "pstack: a file" }]);
  });
});
