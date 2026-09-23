import { describe, expect, test } from "bun:test";
import { shellJoin, shellQuote } from "../../../src/domain/mcp/shell-quote";

describe("shellQuote", () => {
  test("a plain word is printed bare", () => {
    expect(shellQuote("uvx")).toBe("uvx");
    expect(shellQuote("--project-from-cwd")).toBe("--project-from-cwd");
    expect(shellQuote("serena-agent==1.5.3")).toBe("serena-agent==1.5.3");
    expect(shellQuote("https://mcp.figma.com/mcp")).toBe("https://mcp.figma.com/mcp");
    expect(shellQuote("/Users/x/bin/tool")).toBe("/Users/x/bin/tool");
  });

  test("a word with a space is single-quoted", () => {
    expect(shellQuote("Authorization: Bearer x")).toBe("'Authorization: Bearer x'");
  });

  test("an embedded single quote survives as '\\''", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test("a ${VAR} reference is single-quoted so the shell leaves it for Claude Code to expand", () => {
    expect(shellQuote("${MY_TOKEN}")).toBe("'${MY_TOKEN}'");
    expect(shellQuote("KEY=${MY_TOKEN}")).toBe("'KEY=${MY_TOKEN}'");
  });

  test("shell metacharacters are quoted", () => {
    for (const word of [
      "a;b",
      "a|b",
      "a&b",
      "a>b",
      "a<b",
      "a`b`",
      "a$b",
      "a*b",
      "a?b",
      "a(b)",
      'a"b',
      "a\\b",
      "a#b",
      "a!b",
      "~",
    ]) {
      expect(shellQuote(word)).toBe(`'${word}'`);
    }
  });

  test("the empty word is an explicit empty string, not nothing", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("shellJoin", () => {
  test("quotes each word and joins with single spaces", () => {
    expect(shellJoin(["echo", "two words", "", "x"])).toBe("echo 'two words' '' x");
  });
});
