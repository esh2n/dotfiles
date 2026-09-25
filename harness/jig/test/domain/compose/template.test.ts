/**
 * Template substitution. Three variables and nothing else: `{{HOME}}`,
 * `{{DOTFILES_ROOT}}`, `{{DOTFILES_PARENT}}` — no escaping, no nesting (jig v1
 * knew only two of the three).
 */

import { describe, expect, test } from "bun:test";
import { applyTemplate } from "../../../src/domain/compose/template";

const vars = {
  HOME: "/Users/me",
  DOTFILES_ROOT: "/Users/me/dotfiles",
  DOTFILES_PARENT: "/Users/me",
};

describe("applyTemplate", () => {
  test("substitutes all three variables", () => {
    expect(
      applyTemplate(
        {
          a: "{{HOME}}/.claude",
          b: "{{DOTFILES_ROOT}}/domains",
          c: "{{DOTFILES_PARENT}}/other-repo",
        },
        vars,
      ),
    ).toEqual({
      a: "/Users/me/.claude",
      b: "/Users/me/dotfiles/domains",
      c: "/Users/me/other-repo",
    });
  });

  test("substitutes inside nested objects and arrays", () => {
    expect(applyTemplate([{ p: "{{HOME}}/x" }], vars)).toEqual([{ p: "/Users/me/x" }]);
  });

  test("leaves unknown placeholders untouched so a typo fails loudly", () => {
    expect(applyTemplate("{{NOPE}}/x", vars)).toEqual("{{NOPE}}/x");
  });

  test("non-strings pass through", () => {
    expect(applyTemplate({ n: 30, b: true, z: null }, vars)).toEqual({ n: 30, b: true, z: null });
  });

  test("object keys are not substituted (values only)", () => {
    expect(applyTemplate({ "{{HOME}}": "v" }, vars)).toEqual({ "{{HOME}}": "v" });
  });
});
