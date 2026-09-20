import { describe, expect, test } from "bun:test";
import { spliceManagedBlock } from "../../../src/domain/tiers/splice";

const MARKERS = {
  begin: "# BEGIN jig:tiers (generated — edit policy/tiers.json, then jig apply)",
  end: "# END jig:tiers",
};

describe("spliceManagedBlock", () => {
  test("replaces the region between markers, keeping everything else byte-for-byte", () => {
    const existing = [
      "top:",
      "  before: kept",
      `  ${MARKERS.begin}`,
      "  old: content",
      "  more: old-stuff",
      `  ${MARKERS.end}`,
      "  after: kept",
      "",
    ].join("\n");

    const block = ["  new:", "    value: fresh"].join("\n");

    const result = spliceManagedBlock(existing, block, MARKERS);

    expect(result).toBe(
      [
        "top:",
        "  before: kept",
        `  ${MARKERS.begin}`,
        "  new:",
        "    value: fresh",
        `  ${MARKERS.end}`,
        "  after: kept",
        "",
      ].join("\n"),
    );
  });

  test("preserves the marker lines' own original indentation verbatim", () => {
    const existing = `a\n    ${MARKERS.begin}\nold\n    ${MARKERS.end}\nb\n`;
    const result = spliceManagedBlock(existing, "new", MARKERS);
    expect(result).toContain(`    ${MARKERS.begin}`);
    expect(result).toContain(`    ${MARKERS.end}`);
  });

  test("throws when the BEGIN marker is missing", () => {
    const existing = `a\n${MARKERS.end}\nb\n`;
    expect(() => spliceManagedBlock(existing, "new", MARKERS)).toThrow(/missing.*BEGIN/i);
  });

  test("throws when the END marker is missing", () => {
    const existing = `a\n${MARKERS.begin}\nb\n`;
    expect(() => spliceManagedBlock(existing, "new", MARKERS)).toThrow(/missing.*END/i);
  });

  test("throws when END appears before BEGIN", () => {
    const existing = `${MARKERS.end}\nx\n${MARKERS.begin}\n`;
    expect(() => spliceManagedBlock(existing, "new", MARKERS)).toThrow(/END.*before.*BEGIN/i);
  });

  test("content outside the block is untouched byte-for-byte, including trailing content after END", () => {
    const existing = `# header comment\n\n${MARKERS.begin}\nold\n${MARKERS.end}\n\n# trailer\ntail: 1\n`;
    const result = spliceManagedBlock(existing, "new", MARKERS);
    expect(result).toBe(
      `# header comment\n\n${MARKERS.begin}\nnew\n${MARKERS.end}\n\n# trailer\ntail: 1\n`,
    );
  });

  test("is idempotent: splicing the same block twice yields the same result", () => {
    const existing = `${MARKERS.begin}\nold\n${MARKERS.end}\n`;
    const once = spliceManagedBlock(existing, "new", MARKERS);
    const twice = spliceManagedBlock(once, "new", MARKERS);
    expect(twice).toBe(once);
  });
});
