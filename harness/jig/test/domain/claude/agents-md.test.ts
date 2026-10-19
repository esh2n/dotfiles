import { describe, expect, test } from "bun:test";
import {
  AGENTS_MD_BYTE_LIMIT,
  agentsMdBytes,
  decisionLines,
  isCommonRule,
  renderAgentsMd,
  renderDecisionSection,
  stripFrontmatter,
} from "../../../src/domain/claude/agents-md";

const H = "/repo/llm/harness";

const note = (title: string, rule: string | undefined, status = "accepted") =>
  [
    `# ${title}`,
    "",
    `Status: ${status} — 理由（2026-09-22）`,
    ...(rule === undefined ? [] : ["", `rule: ${rule}`]),
    "",
    "## Problem",
    "…",
  ].join("\n");

describe("which notes bind", () => {
  test("the line is the note's `rule:` line, verbatim — never the Japanese title", () => {
    const { lines } = decisionLines([
      {
        file: "a.md",
        text: note("フックは五つ", "Register exactly one hook per event, five total."),
      },
    ]);
    expect(lines).toEqual([
      { file: "a.md", rule: "Register exactly one hook per event, five total.", scope: "global" },
    ]);
  });

  test("an accepted note with no `rule:` line does not bind, and is flagged for a human", () => {
    const { lines, skipped } = decisionLines([{ file: "b.md", text: note("題だけ", undefined) }]);
    expect(lines).toEqual([]);
    expect(skipped[0]?.missingRule).toBe(true);
    expect(skipped[0]?.reason).toContain("no `rule:` line");
  });

  test("a superseded note stays on disk but stops binding, even when it carries a rule", () => {
    const { lines, skipped } = decisionLines([
      { file: "old.md", text: note("古い決定", "Do the old thing.", "superseded") },
    ]);
    expect(lines).toEqual([]);
    expect(skipped[0]).toEqual({
      file: "old.md",
      reason: 'status is "superseded", not accepted',
      missingRule: false,
    });
  });

  test("README.md and a note with no Status are not rule gaps", () => {
    const { skipped } = decisionLines([
      { file: "README.md", text: "# Decisions\n" },
      { file: "no-status.md", text: "# タイトルだけ\n" },
    ]);
    expect(skipped.map((entry) => entry.missingRule)).toEqual([false, false]);
    expect(skipped.map((entry) => entry.reason)).toEqual([
      "not a decision note",
      "no `Status:` line",
    ]);
  });

  test("a rule spanning the rest of its line is taken whole, trailing space trimmed", () => {
    const { lines } = decisionLines([
      {
        file: "c.md",
        text: note("x", "Write everything the model reads in English; keep notes Japanese.  "),
      },
    ]);
    expect(lines[0]?.rule).toBe(
      "Write everything the model reads in English; keep notes Japanese.",
    );
  });

  test("an empty `rule:` line counts as missing, not as an empty binding", () => {
    const { lines, skipped } = decisionLines([
      { file: "d.md", text: "# t\n\nStatus: accepted — x\n\nrule:   \n" },
    ]);
    expect(lines).toEqual([]);
    expect(skipped[0]?.missingRule).toBe(true);
  });
});

describe("decision scope", () => {
  test("only a scope line right under rule: counts, not one in the body", () => {
    const { lines } = decisionLines([
      { file: "a.md", text: `${note("題", "Everywhere.")}\n\n\`\`\`\nscope: repo\n\`\`\`\n` },
    ]);
    expect(lines[0]?.scope).toBe("global");
  });

  test("a note is global unless it says scope: repo", () => {
    const { lines } = decisionLines([
      { file: "a.md", text: note("題", "Everywhere.") },
      {
        file: "b.md",
        text: note("題", "Only here.").replace("rule: Only here.", "rule: Only here.\nscope: repo"),
      },
    ]);
    expect(lines.map((line) => [line.file, line.scope])).toEqual([
      ["a.md", "global"],
      ["b.md", "repo"],
    ]);
  });
});

describe("the rendered section", () => {
  const decisions = decisionLines([
    { file: "a.md", text: note("題", "Do the thing.") },
    {
      file: "b.md",
      text: note("題", "Only in the dotfiles.").replace(
        "rule: Only in the dotfiles.",
        "rule: Only in the dotfiles.\nscope: repo",
      ),
    },
  ]);

  test("the research-index line comes first, then one plain line per global decision naming its note", () => {
    const lines = renderDecisionSection(decisions, H).trimEnd().split("\n");
    expect(lines[0]).toBe(
      `**Before researching anything, read [rules/knowledge/INDEX.md](${H}/rules/knowledge/INDEX.md) (settled facts) and [rules/research/INDEX.md](${H}/rules/research/INDEX.md) (research of the last 14 days). Do not re-investigate settled facts.**`,
    );
    expect(lines.at(-1)).toBe("- Do the thing. (a.md)");
    expect(lines.join("\n")).not.toContain("Only in the dotfiles.");
  });

  test("the notes' directory is named once, absolute, not once per line", () => {
    const text = renderDecisionSection(decisions, H);
    expect(text.split(`${H}/rules/decisions/`).length - 1).toBe(1);
  });

  test("the repository's own section carries only the repo-scoped decisions", () => {
    const text = renderDecisionSection(decisions, H, "repo");
    expect(text).toContain("- Only in the dotfiles. (b.md)");
    expect(text).not.toContain("Do the thing.");
    expect(text).not.toContain("Before researching anything");
  });

  test("the section is English: it is read by the model, not by the owner", () => {
    const text = renderDecisionSection(
      decisionLines([{ file: "a.md", text: note("日本語の題", "An English rule.") }]),
      H,
    );
    expect(text).not.toContain("日本語の題");
    expect(text).toContain("## Decisions");
  });

  test("no bound decisions still renders a valid section", () => {
    expect(renderDecisionSection({ lines: [], skipped: [] }, H)).toContain(
      "(no accepted decision note carries a `rule:` line yet)",
    );
  });
});

describe("the common rules", () => {
  test("frontmatter is stripped only when it opens the file", () => {
    expect(stripFrontmatter("---\npaths:\n  - '**/*.go'\n---\n# Go\n\nbody\n")).toBe(
      "# Go\n\nbody\n",
    );
    expect(stripFrontmatter("# No frontmatter\n\n---\n\nrule\n")).toBe(
      "# No frontmatter\n\n---\n\nrule\n",
    );
  });

  test("README.md documents the directory and is not a rule; anything not .md is not one either", () => {
    expect(isCommonRule("git-workflow.md")).toBe(true);
    expect(isCommonRule("README.md")).toBe(false);
    expect(isCommonRule("notes.txt")).toBe(false);
  });
});

describe("the whole file", () => {
  const decisions = decisionLines([{ file: "a.md", text: note("題", "Do the thing.") }]);

  test("header naming the sources, then the common bodies in file-name order, then the decisions", () => {
    const text = renderAgentsMd({
      harnessRoot: H,
      common: [
        { file: "b-second.md", text: "# Second\n\ntwo\n" },
        { file: "a-first.md", text: "---\npaths:\n  - x\n---\n# First\n\none\n\n\n" },
      ],
      decisions,
    });
    expect(text).toBe(
      [
        `<!-- generated by jig apply --target claude from ${H}/rules/ — edit the sources, not this file -->`,
        "",
        "# First",
        "",
        "one",
        "",
        "# Second",
        "",
        "two",
        "",
        renderDecisionSection(decisions, H),
      ].join("\n"),
    );
  });

  test("bodies are verbatim: nothing is reflowed, retitled or translated", () => {
    const body = "# 見出し\n\n- keep   this   spacing\n\n    indented code\n";
    const text = renderAgentsMd({
      harnessRoot: H,
      common: [{ file: "r.md", text: body }],
      decisions,
    });
    expect(text).toContain(body.trimEnd());
  });

  test("no common rules yet (today) still yields a valid file", () => {
    const text = renderAgentsMd({ harnessRoot: H, common: [], decisions });
    expect(text.startsWith("<!-- generated by jig apply")).toBe(true);
    expect(text).toContain("## Decisions");
    expect(text.endsWith("\n")).toBe(true);
  });

  test("the size is measured in bytes, against the Codex limit", () => {
    expect(agentsMdBytes("日本語")).toBe(9);
    expect(AGENTS_MD_BYTE_LIMIT).toBe(32768);
  });
});
