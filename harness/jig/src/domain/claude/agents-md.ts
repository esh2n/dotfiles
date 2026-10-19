/**
 * The generated `~/.claude/AGENTS.md`, in three parts: a one-line header
 * naming the sources, the always-on rules of `rules/common/` verbatim, and the
 * two parts that already have a ruling:
 *
 * - `rules/decisions/2026-09-22-decision-records.md`: one line per accepted
 *   note. The note itself is the record; AGENTS.md is the binding. Lines are
 *   plain, not bold (`2026-10-18-decision-scope.md`): every one binds, so bold
 *   would mark nothing. Each ends with its note's file name, and the notes'
 *   directory is named once per section.
 * - `rules/decisions/2026-09-22-writeup-markdown-source-two-builds.md` and
 *   `2026-09-27-records-flow-and-stock.md`: one opening line pointing at the
 *   two indexes, `rules/knowledge/INDEX.md` (settled facts) and
 *   `rules/research/INDEX.md` (research of the last 14 days).
 *
 * The line is the note's `rule:` line, copied verbatim, and never the
 * note's Japanese title. `rules/decisions/2026-09-23-model-facing-english.md`
 * rules both halves of that: what the model reads is English, what the owner
 * reads stays Japanese, and 「継ぎ目は自動翻訳しない。各決定メモの先頭に、
 * 裁定の時点で人が書く英語一行 `rule:` を持たせ、生成器はそれをそのまま
 * AGENTS.md の太字一行に写す。」 (the bold was dropped later, as above.) So
 * this renderer transforms nothing: it locates one line and copies it. An accepted note with no `rule:` line is
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
 * The `rules/common/*.md` bodies are rendered INTO this file rather than
 * linked as rule files: `~/.claude/rules/` is for the conditional rules whose
 * `paths:` frontmatter decides when they load, and an always-on rule linked
 * there would be read twice. Their own frontmatter, if any, is stripped — it
 * is metadata for the rule loader, not text for the model.
 *
 * Every link is absolute under the harness root. The file lives in
 * `~/.claude`, so a relative `rules/decisions/...` would resolve nowhere.
 *
 * Pure: the caller reads the directories and hands over file name + text.
 */

export interface DecisionSource {
  /** File name only, e.g. `2026-09-22-box-shape.md`. */
  readonly file: string;
  readonly text: string;
}

/**
 * Where a decision binds. `global` (the default) goes into every harness's
 * AGENTS.md; `repo` (a `scope: repo` line in the note) only into the dotfiles
 * repository's own AGENTS.md, because it rules how this repository is built
 * — Nix, dotctl, jig, the home LLM — and is noise in every other project.
 */
export type DecisionScope = "global" | "repo";

export interface DecisionLine {
  readonly file: string;
  /** The note's `rule:` line, verbatim. */
  readonly rule: string;
  readonly scope: DecisionScope;
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
/** `scope: repo` on the line right under `rule:`; anything else, or none, is global. */
const SCOPE_RE = /^rule:[^\n]*\nscope:[ \t]*repo[ \t]*$/m;

/** Where the decision notes live, relative to the harness root — used to build the links. */
export const DECISIONS_DIR = "rules/decisions";
/** The research index AGENTS.md points at: flow, the last 14 days (rules/decisions/2026-09-27-records-flow-and-stock.md). */
export const RESEARCH_INDEX = "rules/research/INDEX.md";
/** The knowledge index AGENTS.md points at: stock, the facts promoted out of research. */
export const KNOWLEDGE_INDEX = "rules/knowledge/INDEX.md";

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
  return { file: source.file, rule, scope: SCOPE_RE.test(source.text) ? "repo" : "global" };
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
 * this file is read by four harnesses, not by a site build. `harnessRoot` is
 * the absolute path of `harness/`. The notes' directory is named once; each
 * line ends with its note's file name, which is enough to open it. Lines are
 * plain: every one of them binds, so bold would mark nothing.
 *
 * `global` renders the research pointer and the global decisions (every
 * harness's AGENTS.md); `repo` renders the repo-scoped ones (the dotfiles
 * repository's own AGENTS.md).
 */
export function renderDecisionSection(
  result: DecisionLinesResult,
  harnessRoot: string,
  scope: DecisionScope = "global",
): string {
  const research = `${harnessRoot}/${RESEARCH_INDEX}`;
  const knowledge = `${harnessRoot}/${KNOWLEDGE_INDEX}`;
  const lines = result.lines.filter((line) => line.scope === scope);
  const out: string[] = [
    ...(scope === "global"
      ? [
          `**Before researching anything, read [${KNOWLEDGE_INDEX}](${knowledge}) (settled facts) and [${RESEARCH_INDEX}](${research}) (research of the last 14 days). Do not re-investigate settled facts.**`,
          "",
        ]
      : []),
    scope === "global" ? "## Decisions" : "## Decisions for this repository",
    "",
  ];
  if (lines.length === 0) {
    out.push(
      scope === "global"
        ? "(no accepted decision note carries a `rule:` line yet)"
        : "(no decision is marked `scope: repo`)",
    );
  } else {
    out.push(
      `Each line is a binding decision; its note, with the reasons and the rejected options, is in ${harnessRoot}/${DECISIONS_DIR}/.`,
      "",
      ...lines.map((line) => `- ${line.rule} (${line.file})`),
    );
  }
  return `${out.join("\n")}\n`;
}

/** One `rules/common/*.md` file: name and text, as read. */
export interface RuleSource {
  readonly file: string;
  readonly text: string;
}

/**
 * Codex reads at most this much of AGENTS.md and silently drops the rest
 * (`rules/decisions/2026-09-22-decision-records.md`, citing codex#7138). The
 * generator reports crossing it; it does not refuse, because the file is
 * still whole for every other harness.
 */
export const AGENTS_MD_BYTE_LIMIT = 32 * 1024;

/** The size the limit is measured in: bytes on disk, not characters. */
export function agentsMdBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** `---\n…\n---\n` at the very start of the file, and nothing else. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/** The body of a rule file: its YAML frontmatter removed when present, the text untouched otherwise. */
export function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_RE, "");
}

/** `rules/common/README.md` documents the directory; it is not a rule. */
export function isCommonRule(file: string): boolean {
  return file.endsWith(".md") && file !== "README.md";
}

export interface AgentsMdInput {
  /** Absolute path of `harness/`. */
  readonly harnessRoot: string;
  /** `rules/common/*.md`, README already excluded. Any order — rendered in file-name order. */
  readonly common: readonly RuleSource[];
  readonly decisions: DecisionLinesResult;
}

/**
 * The whole file. Header, the common rules' bodies separated by one blank
 * line, then the decision section. Bodies are copied verbatim apart from the
 * frontmatter and their trailing newlines, which the separator supplies.
 */
/**
 * The dotfiles repository's own AGENTS.md: the repo-scoped decisions. It is
 * generated into the checkout's root, untracked, and every harness reads it
 * when it works in this repository.
 */
export function renderRepoAgentsMd(
  input: Pick<AgentsMdInput, "harnessRoot" | "decisions">,
): string {
  const header = `<!-- generated by jig apply --target claude from ${input.harnessRoot}/rules/decisions/ (the notes with \`scope: repo\`) — edit the notes, not this file -->`;
  return [header, renderDecisionSection(input.decisions, input.harnessRoot, "repo")].join("\n\n");
}

export function renderAgentsMd(input: AgentsMdInput): string {
  const header = `<!-- generated by jig apply --target claude from ${input.harnessRoot}/rules/ — edit the sources, not this file -->`;
  const bodies = [...input.common]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((source) => stripFrontmatter(source.text).replace(/\n+$/, ""))
    .filter((body) => body !== "");
  return [header, ...bodies, renderDecisionSection(input.decisions, input.harnessRoot)].join(
    "\n\n",
  );
}
