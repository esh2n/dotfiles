import { describe, expect, test } from "bun:test";
import { decisionLines, renderDecisionSection } from "../../../src/domain/claude/agents-md";

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
  test("the bold line is the note's `rule:` line, verbatim — never the Japanese title", () => {
    const { lines } = decisionLines([
      {
        file: "a.md",
        text: note("フックは五つ", "Register exactly one hook per event, five total."),
      },
    ]);
    expect(lines).toEqual([
      { file: "a.md", rule: "Register exactly one hook per event, five total." },
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

describe("the rendered section", () => {
  test("the research-index line comes first, then one bold linked line per decision", () => {
    const text = renderDecisionSection(
      decisionLines([{ file: "a.md", text: note("題", "Do the thing.") }]),
    );
    const lines = text.trimEnd().split("\n");

    expect(lines[0]).toBe(
      "**Read [rules/research/INDEX.md](rules/research/INDEX.md) before researching anything. Do not re-investigate settled facts.**",
    );
    expect(lines.at(-1)).toBe("- **Do the thing.** — [a.md](rules/decisions/a.md)");
  });

  test("the section is English: it is read by the model, not by the owner", () => {
    const text = renderDecisionSection(
      decisionLines([{ file: "a.md", text: note("日本語の題", "An English rule.") }]),
    );
    expect(text).not.toContain("日本語の題");
    expect(text).toContain("## Decisions");
  });

  test("one line per decision and no prose around it — Codex truncates past 32 KiB", () => {
    const sources = Array.from({ length: 40 }, (_, i) => ({
      file: `2026-09-22-${i}.md`,
      text: note(`決定 ${i}`, `Rule number ${i}.`),
    }));
    const text = renderDecisionSection(decisionLines(sources));
    const bullets = text.split("\n").filter((line) => line.startsWith("- **"));
    expect(bullets).toHaveLength(40);
  });

  test("no bound decisions still renders a valid section", () => {
    expect(renderDecisionSection({ lines: [], skipped: [] })).toContain(
      "(no accepted decision note carries a `rule:` line yet)",
    );
  });
});
