import { describe, expect, test } from "bun:test";
import { parseRulesProfile, selectCommon } from "../../../src/domain/claude/rules-profile";

describe("parseRulesProfile", () => {
  test("a profile names the common rules it keeps and whether decisions render", () => {
    const profile = parseRulesProfile(
      "pstack",
      JSON.stringify({ common: ["10-git.md", "30-security.md"], decisions: false }),
    );
    expect(profile).toEqual({
      name: "pstack",
      common: ["10-git.md", "30-security.md"],
      decisions: false,
    });
  });

  test("a wrong shape fails loudly rather than rendering the wrong rules", () => {
    expect(() => parseRulesProfile("pstack", "not json")).toThrow("not JSON");
    expect(() => parseRulesProfile("pstack", "[]")).toThrow("must be an object");
    expect(() => parseRulesProfile("pstack", JSON.stringify({ decisions: true }))).toThrow(
      '"common" must be an array',
    );
    expect(() =>
      parseRulesProfile("pstack", JSON.stringify({ common: ["10-git.md"], decisions: "no" })),
    ).toThrow('"decisions" must be true or false');
    expect(() =>
      parseRulesProfile("pstack", JSON.stringify({ common: ["../x.md"], decisions: true })),
    ).toThrow("not a rules/common file name");
    expect(() =>
      parseRulesProfile("pstack", JSON.stringify({ common: ["README.md"], decisions: true })),
    ).toThrow("not a rules/common file name");
  });

  test("the profile name is a directory name: lowercase, digits, hyphens", () => {
    expect(() => parseRulesProfile("P Stack", "{}")).toThrow("not lowercase");
  });
});

describe("selectCommon", () => {
  const sources = [
    { file: "10-git.md", text: "git" },
    { file: "20-execution.md", text: "exec" },
    { file: "30-security.md", text: "sec" },
  ];

  test("keeps only the listed files and reports the ones that do not exist", () => {
    const { kept, missing } = selectCommon(sources, {
      name: "p",
      common: ["30-security.md", "10-git.md", "99-gone.md"],
      decisions: false,
    });
    expect(kept.map((s) => s.file)).toEqual(["30-security.md", "10-git.md"]);
    expect(missing).toEqual(["99-gone.md"]);
  });
});
