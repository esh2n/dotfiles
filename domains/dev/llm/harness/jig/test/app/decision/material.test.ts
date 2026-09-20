import { describe, expect, test } from "bun:test";
import { boundedMaterial } from "../../../src/app/decision/material";

describe("boundedMaterial", () => {
  test("a short request is sent as it is", () => {
    expect(boundedMaterial("rename a variable")).toBe("rename a variable");
  });

  test("a long request keeps both ends and announces the elision", () => {
    const request = `START ${"x".repeat(9_000)} MIDDLE_MARKER ${"y".repeat(9_000)} ASK`;

    const material = boundedMaterial(request);

    expect(material.startsWith("START ")).toBe(true);
    expect(material.endsWith(" ASK")).toBe(true);
    expect(material).toContain("characters elided from the middle");
    // The only thing that goes is the middle.
    expect(material).not.toContain("MIDDLE_MARKER");
    // Bounded to the two windows plus the one-line marker and its separators.
    expect(material.length).toBeLessThan(4_200);
  });

  test("the middle is the part that goes, not the ask at the end", () => {
    const request = `${"a".repeat(5_000)} the real question at the end?`;
    expect(boundedMaterial(request).endsWith(" the real question at the end?")).toBe(true);
  });
});
