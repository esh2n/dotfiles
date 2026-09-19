import { describe, expect, test } from "bun:test";
import { applyTemplate } from "../../../src/domain/compose/template";

const vars = { DOTFILES_ROOT: "/repo", HOME: "/home/me" };

describe("applyTemplate", () => {
  test("replaces a known variable inside a string", () => {
    expect(applyTemplate("{{DOTFILES_ROOT}}/x", vars)).toBe("/repo/x");
  });

  test("replaces every occurrence and multiple variables in one string", () => {
    expect(applyTemplate("{{HOME}}/.claude at {{DOTFILES_ROOT}} for {{HOME}}", vars)).toBe(
      "/home/me/.claude at /repo for /home/me",
    );
  });

  test("recurses into objects and arrays", () => {
    const input = {
      env: { YOKI_ROOT: "{{DOTFILES_ROOT}}/runtime", HOMUNCULUS: "{{HOME}}/.claude/homunculus" },
      list: ["{{HOME}}/a", "plain"],
    };
    expect(applyTemplate(input, vars)).toEqual({
      env: { YOKI_ROOT: "/repo/runtime", HOMUNCULUS: "/home/me/.claude/homunculus" },
      list: ["/home/me/a", "plain"],
    });
  });

  test("leaves unknown placeholders untouched", () => {
    expect(applyTemplate("{{UNKNOWN}}/x", vars)).toBe("{{UNKNOWN}}/x");
  });

  test("leaves non-string scalars unchanged", () => {
    expect(applyTemplate({ n: 1, b: true, z: null }, vars)).toEqual({ n: 1, b: true, z: null });
  });
});
