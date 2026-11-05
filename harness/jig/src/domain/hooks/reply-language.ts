/**
 * Whether the turn's replies are written in the language Claude Code's `language`
 * setting asks for (`rules/decisions/2026-11-05-reply-language-check-on-stop.md`).
 *
 * Only the prose is judged: code, URLs and paths are removed first, because a reply in
 * the right language still names files, commands and identifiers in Latin letters.
 */

export type ReplyLanguageVerdict = "matches" | "off-language" | "too-short";

interface LanguageRule {
  /** The name the reason gives the model. */
  readonly name: string;
  readonly native: RegExp;
  /** Below this share of native characters among native plus Latin letters, the reply is off-language. */
  readonly minNativeShare: number;
}

/**
 * Measured on 2,382 past assistant messages: Japanese replies bottom out near 0.26 (a line
 * that is mostly tab and product names), English ones top out near 0.11 (a sentence quoting
 * one Japanese label). 0.2 sits in that gap.
 */
const JAPANESE: LanguageRule = {
  name: "Japanese",
  native: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  minNativeShare: 0.2,
};

const RULES: Readonly<Record<string, LanguageRule>> = {
  japanese: JAPANESE,
  ja: JAPANESE,
  日本語: JAPANESE,
};

/** Fewer counted characters than this is a one-line acknowledgement, not worth a rewrite. */
const MIN_JUDGED_CHARS = 20;

/** The rule for a `language` setting value, or `undefined` when it is absent or not supported. */
export function replyLanguageRule(setting: unknown): LanguageRule | undefined {
  if (typeof setting !== "string") return undefined;
  return RULES[setting.trim().toLowerCase()];
}

const NOT_PROSE: readonly RegExp[] = [
  /```[\s\S]*?(?:```|$)/g,
  /~~~[\s\S]*?(?:~~~|$)/g,
  /`[^`\n]*`/g,
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /(?:~|\.{1,2})?\/?[\w.@-]+(?:\/[\w.@-]+)+/g,
  /\b[\w-]+\.[a-z][a-z0-9]{0,4}\b/gi,
];

function prose(text: string): string {
  return NOT_PROSE.reduce((rest, pattern) => rest.replace(pattern, " "), text);
}

export function judgeReplyLanguage(text: string, rule: LanguageRule): ReplyLanguageVerdict {
  const rest = prose(text);
  const native = rest.match(rule.native)?.length ?? 0;
  const latin = rest.match(/[A-Za-z]/g)?.length ?? 0;
  const total = native + latin;
  if (total < MIN_JUDGED_CHARS) return "too-short";
  return native / total < rule.minNativeShare ? "off-language" : "matches";
}

const EXCERPT_CHARS = 120;
/** Past this many, the reason gives a count: the model needs the gist, not a transcript. */
const MAX_LISTED = 10;

/** How a passage is quoted in the reason; the gate also looks for it in earlier feedback. */
export function passageExcerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > EXCERPT_CHARS ? `${line.slice(0, EXCERPT_CHARS)}…` : line;
}

/** @param passages the turn's texts judged off-language, in the order they were written. */
export function replyLanguageReason(rule: LanguageRule, passages: readonly string[]): string {
  const listed = passages
    .slice(0, MAX_LISTED)
    .map((passage, i) => `${i + 1}. "${passageExcerpt(passage)}"`);
  const rest = passages.length - listed.length;
  return [
    `jig gate: Claude Code's \`language\` setting asks for replies in ${rule.name}, but these passages you wrote this turn are mostly in another language:`,
    ...listed,
    ...(rest > 0 ? [`…and ${rest} more.`] : []),
    `Write your final message in ${rule.name}, restating in ${rule.name} what these passages said; keep code, commands, paths and identifiers as they are. This check runs once per turn, so the next stop ends the turn.`,
  ].join("\n");
}
