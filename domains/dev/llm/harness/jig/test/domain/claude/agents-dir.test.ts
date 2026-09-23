import { describe, expect, test } from "bun:test";
import { selectAgentFiles } from "../../../src/domain/claude/agents-dir";

describe("selectAgentFiles", () => {
  test("every regular *.md file is an agent definition; anything else is named and skipped", () => {
    const { linked, excluded } = selectAgentFiles([
      { name: "research.md", state: { kind: "file" } },
      { name: "architect.md", state: { kind: "file" } },
      { name: "notes.txt", state: { kind: "file" } },
      { name: "drafts.md", state: { kind: "dir" } },
      { name: "linked.md", state: { kind: "symlink", target: "/elsewhere/linked.md" } },
    ]);
    expect(linked).toEqual(["architect.md", "research.md"]);
    expect(excluded).toEqual([
      { name: "drafts.md", reason: "a directory, not a *.md agent definition" },
      { name: "linked.md", reason: "a symlink, not a regular *.md file" },
      { name: "notes.txt", reason: "not a *.md file" },
    ]);
  });

  test("an empty source is an empty selection", () => {
    expect(selectAgentFiles([])).toEqual({ linked: [], excluded: [] });
  });
});
