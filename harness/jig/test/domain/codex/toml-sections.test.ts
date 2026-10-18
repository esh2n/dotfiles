import { describe, expect, test } from "bun:test";
import {
  type Section,
  joinSections,
  keyStatement,
  parseSections,
  removeSections,
  topKeys,
  withoutKey,
  withoutLines,
} from "../../../src/domain/codex/toml-sections";

/** The section at `index`, failing the test when it is not there. */
function sectionAt(text: string, index: number): Section {
  const section = parseSections(text)[index];
  if (section === undefined) throw new Error(`no section ${index}`);
  return section;
}

describe("parseSections", () => {
  test("a line that looks like a header inside a multi-line array is data", () => {
    const text = ["[a]", "x = [", '  ["y"]', "]", "[b]", "z = 1"].join("\n");
    expect(parseSections(text).map((s) => s.path)).toEqual([undefined, ["a"], ["b"]]);
  });

  test("a line that looks like a header inside a multi-line string is data", () => {
    const text = ["[a]", 'note = """', "[mcp_servers.serena]", '"""', "[b]"].join("\n");
    expect(parseSections(text).map((s) => s.path)).toEqual([undefined, ["a"], ["b"]]);
    const literal = ["[a]", "note = '''", "[tui]", "'''", "[b]"].join("\n");
    expect(parseSections(literal).map((s) => s.path)).toEqual([undefined, ["a"], ["b"]]);
  });

  test("brackets and hashes inside quoted strings do not open anything", () => {
    const text = ["[a]", 'x = "[ { #"', "[b]"].join("\n");
    expect(parseSections(text).map((s) => s.path)).toEqual([undefined, ["a"], ["b"]]);
  });

  test("quoted keys with dots are one segment", () => {
    expect(parseSections('[hooks.state."/h/hooks.json:stop:0:0"]\n')[1]?.path).toEqual([
      "hooks",
      "state",
      "/h/hooks.json:stop:0:0",
    ]);
  });
});

describe("removing what jig owns", () => {
  test("the comment above the next table stays when the table before it goes", () => {
    const text = [
      "[mine]",
      "a = 1",
      "",
      "# my trusted projects",
      '[projects."x"]',
      'trust_level = "trusted"',
    ].join("\n");
    const kept = removeSections(parseSections(text), (s) => s.path?.[0] === "mine");
    expect(joinSections(kept)).toBe(
      ["", "# my trusted projects", '[projects."x"]', 'trust_level = "trusted"'].join("\n"),
    );
  });

  test("a key's whole multi-line value goes, and nothing after it", () => {
    const tui = sectionAt(
      ["[tui]", "status_line = [", '  "model",', '  "dir",', "]", "animations = false"].join("\n"),
      1,
    );
    expect(withoutKey(tui, "status_line").lines).toEqual(["[tui]", "animations = false"]);
    expect(keyStatement(tui, "status_line")).toBe('status_line = [\n  "model",\n  "dir",\n]');
  });

  test("marker text inside a multi-line string is data, not a marker", () => {
    const text = ['x = """', "# jig:begin mcp", '"""', "# jig:begin mcp"].join("\n");
    expect(withoutLines(text, ["# jig:begin mcp"])).toBe(
      ['x = """', "# jig:begin mcp", '"""'].join("\n"),
    );
  });

  test("topKeys names the first segment of each statement, skipping multi-line values", () => {
    const servers = sectionAt(
      [
        "[mcp_servers]",
        'serena = { command = "uvx" }',
        'other.command = "x"',
        "list = [",
        '  "notakey = 1",',
        "]",
      ].join("\n"),
      1,
    );
    expect(topKeys(servers)).toEqual(["serena", "other", "list"]);
  });
});
