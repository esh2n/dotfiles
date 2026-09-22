import { describe, expect, test } from "bun:test";
import { boxName, boxNamePrefix, repoBasename } from "../../../src/app/box/name";

/** `sbx create --help`: >=2 chars, leading letter or digit, only [a-z0-9.-], not `default`. */
function isValidSbxName(name: string): boolean {
  return name.length >= 2 && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(name) && name !== "default";
}

describe("repoBasename", () => {
  test("takes the last segment and ignores trailing slashes", () => {
    expect(repoBasename("/a/b/dotfiles")).toBe("dotfiles");
    expect(repoBasename("/a/b/dotfiles/")).toBe("dotfiles");
    expect(repoBasename("")).toBe("");
  });
});

describe("boxName", () => {
  test("joins agent, repo and branch", () => {
    expect(boxName({ agent: "claude", repoPath: "/x/dotfiles", branch: "main" })).toBe(
      "claude-dotfiles-main",
    );
  });

  test("a slashed branch becomes hyphens, not a second path segment", () => {
    expect(boxName({ agent: "claude", repoPath: "/x/dotfiles", branch: "feat/jig-box" })).toBe(
      "claude-dotfiles-feat-jig-box",
    );
  });

  test("uppercase and underscores are normalized", () => {
    expect(boxName({ agent: "codex", repoPath: "/x/My_Repo", branch: "Fix_Thing" })).toBe(
      "codex-my-repo-fix-thing",
    );
  });

  test("characters outside sbx's alphabet are dropped and runs collapse", () => {
    const name = boxName({ agent: "claude", repoPath: "/x/re:po", branch: "wip/日本語/x" });
    expect(name).toBe("claude-repo-wip-x");
    expect(isValidSbxName(name)).toBe(true);
  });

  test("never exceeds 60 characters and never ends on a separator", () => {
    const name = boxName({
      agent: "claude",
      repoPath: "/x/a-very-long-repository-name-that-goes-on",
      branch: "and-an-even-longer-branch-name-than-that-one-here",
    });
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith("-")).toBe(false);
    expect(isValidSbxName(name)).toBe(true);
  });

  test("a name that would start with a separator starts with a letter instead", () => {
    const name = boxName({ agent: "-", repoPath: "/x/-repo", branch: "-b" });
    expect(isValidSbxName(name)).toBe(true);
  });

  test("everything unusable still yields a valid name", () => {
    const name = boxName({ agent: "…", repoPath: "/…", branch: "…" });
    expect(isValidSbxName(name)).toBe(true);
  });

  test("the reserved name is avoided", () => {
    expect(boxName({ agent: "default", repoPath: "/", branch: "" })).toBe("default-box");
  });

  test("is stable: the same inputs always give the same box", () => {
    const input = { agent: "claude", repoPath: "/x/dotfiles", branch: "main" };
    expect(boxName(input)).toBe(boxName(input));
  });
});

describe("boxNamePrefix", () => {
  test("is the prefix boxName produces for that agent and repo", () => {
    const prefix = boxNamePrefix("claude", "/x/dotfiles");
    expect(prefix).toBe("claude-dotfiles-");
    expect(boxName({ agent: "claude", repoPath: "/x/dotfiles", branch: "main" })).toStartWith(
      prefix,
    );
  });
});
