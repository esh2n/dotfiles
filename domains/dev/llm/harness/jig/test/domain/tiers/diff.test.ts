import { describe, expect, test } from "bun:test";
import { unifiedDiff } from "../../../src/domain/tiers/diff";

describe("unifiedDiff", () => {
  test("returns empty string for identical text", () => {
    expect(unifiedDiff("a", "same\nsame\n", "b", "same\nsame\n")).toBe("");
  });

  test("shows a one-line change with file headers", () => {
    const result = unifiedDiff("current", "one\ntwo\nthree\n", "generated", "one\nTWO\nthree\n");
    expect(result).toContain("--- current");
    expect(result).toContain("+++ generated");
    expect(result).toContain("-two");
    expect(result).toContain("+TWO");
    expect(result).toContain(" one");
    expect(result).toContain(" three");
  });

  test("shows an added line", () => {
    const result = unifiedDiff("a", "one\ntwo\n", "b", "one\ntwo\nthree\n");
    expect(result).toContain("+three");
  });

  test("shows a removed line", () => {
    const result = unifiedDiff("a", "one\ntwo\nthree\n", "b", "one\nthree\n");
    expect(result).toContain("-two");
  });

  test("hunk header reports correct line ranges", () => {
    const result = unifiedDiff("a", "1\n2\n3\n4\n5\n", "b", "1\n2\nCHANGED\n4\n5\n");
    expect(result).toMatch(/@@ -1,5 \+1,5 @@/);
  });
});
