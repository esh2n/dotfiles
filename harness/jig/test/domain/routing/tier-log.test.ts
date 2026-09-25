import { describe, expect, test } from "bun:test";
import { PROMPT_PREVIEW_CHARS, promptPreview } from "../../../src/domain/routing/tier-log";

describe("promptPreview", () => {
  test("first line only, whitespace collapsed", () => {
    expect(promptPreview("  fix   the\tbug\nand more")).toBe("fix the bug");
  });
  test("cut to the preview length with an ellipsis", () => {
    const long = "x".repeat(PROMPT_PREVIEW_CHARS + 20);
    expect(promptPreview(long)).toHaveLength(PROMPT_PREVIEW_CHARS);
    expect(promptPreview(long).endsWith("…")).toBe(true);
  });
  test("empty stays empty", () => {
    expect(promptPreview("")).toBe("");
  });
});
