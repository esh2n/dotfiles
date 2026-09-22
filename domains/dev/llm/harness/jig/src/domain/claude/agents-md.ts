/**
 * The two generated parts of `~/.claude/AGENTS.md` that already have a ruling,
 * rendered ahead of the rest of the file (milestone 2).
 *
 * - `rules/decisions/2026-09-22-decision-records.md`: 「行動を縛る決定は、
 *   生成される AGENTS.md に太字一行とメモへのリンクとして入れる。」 One bold
 *   line per accepted note, linking the note. The note itself is the record;
 *   AGENTS.md is the binding.
 * - `rules/decisions/2026-09-22-writeup-markdown-source-two-builds.md`:
 *   「索引 `rules/research/INDEX.md` … から『調べる前に索引を読め。確立済みの
 *   事実は再調査しない』で指す。」 One line, pointing at the index.
 *
 * The bold line is the note's `rule:` line, copied verbatim, and never the
 * note's Japanese title. `rules/decisions/2026-09-23-model-facing-english.md`
 * rules both halves of that: what the model reads is English, what the owner
 * reads stays Japanese, and 「継ぎ目は自動翻訳しない。各決定メモの先頭に、
 * 裁定の時点で人が書く英語一行 `rule:` を持たせ、生成器はそれをそのまま
 * AGENTS.md の太字一行に写す。」 So this renderer transforms nothing: it
 * locates one line and copies it. An accepted note with no `rule:` line is
 * *not* rendered — a note whose binding text a human has not yet written has
 * no binding text, and inventing one from the title would be the machine
 * translation the ruling forbids. It is reported instead, so the gap is
 * visible rather than silently absent.
 *
 * Size matters here: the same decision record notes Codex silently truncates
 * AGENTS.md past 32 KiB, and every harness reads this file. One line per
 * decision is the budget — the `rule:` line and nothing else, no title, no
 * status text, no date.
 *
 * Only `Status: accepted` notes are rendered. A note that was superseded is
 * kept on disk (「採択後は決定を書き換えず、新しいメモで上書きする」) but must
 * not keep binding, and a note with no parseable status is reported rather
 * than guessed at.
 *
 * Pure: the caller reads the directory and hands over file name + text.
 */

export interface DecisionSource {
  /** File name only, e.g. `2026-09-22-box-shape.md`. */
  readonly file: string;
  readonly text: string;
}

export interface DecisionLine {
  readonly file: string;
  /** The note's `rule:` line, verbatim. */
  readonly rule: string;
}

export interface SkippedDecision {
  readonly file: string;
  readonly reason: string;
  /**
   * True when the note is accepted but carries no `rule:` line — a gap a human
   * has to fill, as opposed to a note that is correctly not rendered (a
   * README, a superseded note). Callers surface these as warnings.
   */
  readonly missingRule: boolean;
}

export interface DecisionLinesResult {
  readonly lines: readonly DecisionLine[];
  /** Files skipped, with why — surfaced rather than silently dropped. */
  readonly skipped: readonly SkippedDecision[];
}

const STATUS_RE = /^Status:\s*([a-z]+)\b/m;
/** `rule: <text>` on one line. Everything after the colon, trimmed, verbatim. */
const RULE_RE = /^rule:[ \t]*(\S.*?)[ \t]*$/m;

/** Where the decision notes live, relative to the harness root — used to build the links. */
export const DECISIONS_DIR = "rules/decisions";
/** The research index AGENTS.md points at. */
export const RESEARCH_INDEX = "rules/research/INDEX.md";

function parseOne(source: DecisionSource): DecisionLine | Omit<SkippedDecision, "file"> {
  if (source.file === "README.md") {
    return { reason: "not a decision note", missingRule: false };
  }
  const status = STATUS_RE.exec(source.text)?.[1];
  if (status === undefined) return { reason: "no `Status:` line", missingRule: false };
  if (status !== "accepted") {
    return { reason: `status is "${status}", not accepted`, missingRule: false };
  }
  const rule = RULE_RE.exec(source.text)?.[1];
  if (rule === undefined) {
    return {
      reason:
        "accepted but has no `rule:` line — a human writes that line, the generator never invents it",
      missingRule: true,
    };
  }
  return { file: source.file, rule };
}

/** Accepted notes that carry a rule, in the order given (the caller sorts — file name is date-first). */
export function decisionLines(sources: readonly DecisionSource[]): DecisionLinesResult {
  const lines: DecisionLine[] = [];
  const skipped: SkippedDecision[] = [];
  for (const source of sources) {
    const parsed = parseOne(source);
    if ("reason" in parsed) skipped.push({ file: source.file, ...parsed });
    else lines.push(parsed);
  }
  return { lines, skipped };
}

/**
 * The decision section of AGENTS.md. Markdown, CommonMark, no directives —
 * this file is read by four harnesses, not by a site build.
 */
export function renderDecisionSection(result: DecisionLinesResult): string {
  const out: string[] = [
    `**Read [${RESEARCH_INDEX}](${RESEARCH_INDEX}) before researching anything. Do not re-investigate settled facts.**`,
    "",
    "## Decisions",
    "",
  ];
  if (result.lines.length === 0) {
    out.push("(no accepted decision note carries a `rule:` line yet)");
  } else {
    for (const line of result.lines) {
      out.push(`- **${line.rule}** — [${line.file}](${DECISIONS_DIR}/${line.file})`);
    }
  }
  return `${out.join("\n")}\n`;
}
