import { describe, expect, test } from "bun:test";
import type { SkillCandidate } from "../../../src/domain/skills/candidate";
import {
  type RepoSignals,
  UNKNOWN_SIGNALS,
  fallbackCatalog,
  renderFallbackCatalog,
} from "../../../src/domain/skills/fallback-catalog";

function skill(name: string, paths?: readonly string[], description = `what ${name} does`) {
  return {
    name,
    description,
    path: `/skills/${name}/SKILL.md`,
    ...(paths === undefined ? {} : { paths }),
  } satisfies SkillCandidate;
}

function signals(extensions: readonly string[], filenames: readonly string[] = []): RepoSignals {
  return { known: true, extensions: new Set(extensions), filenames: new Set(filenames) };
}

const CATALOG: readonly SkillCandidate[] = [
  skill("writeup"),
  skill("golang-patterns", ["**/*.go", "**/go.mod"]),
  skill("python-testing", ["**/*.py"]),
  skill("react-patterns", ["**/*.{ts,tsx}", "**/*.jsx"]),
  skill("css-cascade", ["**/*.css"]),
];

const names = (skills: readonly SkillCandidate[]) => skills.map((candidate) => candidate.name);

describe("fallbackCatalog", () => {
  test("keeps a skill with no paths, whatever the repository is", () => {
    expect(names(fallbackCatalog(CATALOG, signals([".go"])))).toContain("writeup");
    expect(names(fallbackCatalog(CATALOG, signals([])))).toEqual(["writeup"]);
  });

  test("keeps a path-scoped skill only when the repository has its extension", () => {
    // The owner's condition: 54 skills is mostly language skills, and a Go repository has no
    // use for the Python ones.
    expect(names(fallbackCatalog(CATALOG, signals([".go", ".md"])))).toEqual([
      "writeup",
      "golang-patterns",
    ]);
  });

  test("matches any one of a skill's globs, not all of them", () => {
    // `**/*.go` misses, `**/go.mod` hits: a vendored module file is still a Go repository.
    expect(names(fallbackCatalog(CATALOG, signals([".md"], ["go.mod"])))).toEqual([
      "writeup",
      "golang-patterns",
    ]);
  });

  test("expands a brace group instead of matching it literally", () => {
    expect(names(fallbackCatalog(CATALOG, signals([".tsx"])))).toEqual([
      "writeup",
      "react-patterns",
    ]);
    expect(names(fallbackCatalog(CATALOG, signals([".ts"])))).toEqual([
      "writeup",
      "react-patterns",
    ]);
  });

  test("reads only the glob's last segment, so a layout difference is not a language difference", () => {
    const scoped = [skill("go-perf", ["cmd/**/*.go", "internal/*.go"])];
    expect(names(fallbackCatalog(scoped, signals([".go"])))).toEqual(["go-perf"]);
  });

  test("keeps a glob it cannot reduce, rather than hiding the skill it belongs to", () => {
    // `src/**` and `Dockerfile*` say nothing about an extension. One extra line is cheaper
    // than a fallback that hides the skill the request needed.
    const unreducible = [skill("infra", ["src/**"]), skill("docker", ["**/Dockerfile*"])];
    expect(names(fallbackCatalog(unreducible, signals([".go"])))).toEqual(["infra", "docker"]);
  });

  test("with no signals at all, keeps only what applies anywhere", () => {
    // Not "keep everything": an unknown repository with every language skill in it is the
    // flooding this exists to prevent.
    expect(names(fallbackCatalog(CATALOG, UNKNOWN_SIGNALS))).toEqual(["writeup"]);
  });

  test("an empty paths list is not the same as no paths list", () => {
    // A skill that declares `paths:` with nothing under it constrains nothing.
    expect(names(fallbackCatalog([skill("empty", [])], UNKNOWN_SIGNALS))).toEqual(["empty"]);
  });
});

describe("renderFallbackCatalog", () => {
  test("says it is not a selection, why, and how to open a skill", () => {
    const text = renderFallbackCatalog(fallbackCatalog(CATALOG, signals([".go"])), "timeout", {
      harness: "claude",
    });

    expect(text).toContain("no selection for this request (the judgment timed out)");
    expect(text).toContain("not a recommendation");
    expect(text).toContain("the router had no opinion");
    // The router's own wording, from the same function — a turn must not be told to open a
    // skill one way on a hit and another way on a miss.
    expect(text).toContain("Invoke each with the Skill tool — `Skill(<name>)`, or `/<name>`.");
    expect(text).toContain('- "writeup": what writeup does');
    expect(text).toContain('- "golang-patterns": what golang-patterns does');
  });

  test("names each reason in its own words", () => {
    const reasons = {
      unreachable: "the judgment service was unreachable",
      malformed: "answered with something that is not a judgment",
      error: "the judgment failed",
      "below-threshold": "no skill cleared the confidence gate",
      "no-match": "the judgment matched no skill",
    } as const;
    for (const [reason, phrase] of Object.entries(reasons)) {
      const text = renderFallbackCatalog([skill("writeup")], reason as keyof typeof reasons);
      expect(text).toContain(phrase);
    }
  });

  test("keeps the path-only wording for a harness that has not said who it is", () => {
    const text = renderFallbackCatalog([skill("writeup")], "error");
    expect(text).toContain("Read and follow these before doing the work.");
    expect(text).not.toContain("Skill tool");
  });

  test("lists alphabetically rather than inventing a ranking", () => {
    const text = renderFallbackCatalog([skill("zebra"), skill("alpha")], "no-match");
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zebra"'));
    expect(text).toContain("Alphabetical");
  });

  test("collapses a multi-line description to one line and caps it", () => {
    const wordy = skill("wordy", undefined, `first line\n  second line\n${"x".repeat(400)}`);
    const text = renderFallbackCatalog([wordy], "no-match", { maxDescriptionChars: 23 });

    const line = text.split("\n").find((entry) => entry.startsWith('- "wordy"')) ?? "";
    expect(line).toBe('- "wordy": first line second line…');
    expect(text.split("\n").filter((entry) => entry.startsWith("- ")).length).toBe(1);
  });

  test("truncates at the cap, keeps the alphabetical head, and says how many it cut", () => {
    const many = Array.from({ length: 60 }, (_value, index) =>
      skill(`skill-${String(index).padStart(2, "0")}`),
    );
    const text = renderFallbackCatalog(many, "unreachable", { maxChars: 1_000 });

    expect(text.length).toBeLessThanOrEqual(1_000);
    expect(text).toContain('- "skill-00"');
    expect(text).not.toContain('- "skill-59"');
    expect(text).toMatch(/… and \d+ more \(cut at 1000 characters\)\.$/);
  });

  test("does not truncate a list that fits, and adds no note", () => {
    const text = renderFallbackCatalog([skill("writeup")], "no-match", { maxChars: 6_000 });
    expect(text).not.toContain("more (cut at");
  });
});
