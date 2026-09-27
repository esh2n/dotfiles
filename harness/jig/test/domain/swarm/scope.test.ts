import { describe, expect, test } from "bun:test";
import { inScope, literalPrefix, scopesOverlap } from "../../../src/domain/swarm/scope";

describe("literal prefix of a path or glob", () => {
  test("stops at the first wildcard segment", () => {
    expect(literalPrefix("src/a/**")).toBe("src/a");
    expect(literalPrefix("src/*.ts")).toBe("src");
    expect(literalPrefix("src/{a,b}/x.ts")).toBe("src");
    expect(literalPrefix("**")).toBe("");
  });

  test("normalizes ./ and doubled slashes", () => {
    expect(literalPrefix("./src//a/x.ts")).toBe("src/a/x.ts");
  });
});

describe("two write scopes overlap", () => {
  test("sibling directories are disjoint", () => {
    expect(scopesOverlap(["src/a/**"], ["src/b/*.ts"])).toBe(false);
  });

  test("a directory contains a file below it", () => {
    expect(scopesOverlap(["src/**"], ["src/a/x.ts"])).toBe(true);
  });

  test("a name that merely starts the same is not inside", () => {
    expect(scopesOverlap(["src/ab/**"], ["src/a/**"])).toBe(false);
  });

  test("the empty scope is the whole checkout and overlaps everything", () => {
    expect(scopesOverlap([], ["docs/x.md"])).toBe(true);
    expect(scopesOverlap([], [])).toBe(true);
  });

  test("any pair across the lists is enough", () => {
    expect(scopesOverlap(["a/**", "b/**"], ["c/**", "b/x"])).toBe(true);
  });
});

describe("a changed path lies in a scope", () => {
  test("inside and outside", () => {
    expect(inScope("src/a/x.ts", ["src/a/**"])).toBe(true);
    expect(inScope("src/b/x.ts", ["src/a/**"])).toBe(false);
  });

  test("an empty scope takes every path", () => {
    expect(inScope("anything", [])).toBe(true);
  });
});
