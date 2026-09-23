// finding.mjs — the Finding shape shared by every detector, plus the small
// helpers (related-lines formatting, per-category suggestions) used to
// build one.
//
// Shape (matches the contract's §6 JSON: category / severity / excerpt /
// span / suggestion, plus `message` for the human-readable detail the
// Python original called `detail`):
//
//   {
//     category: string,
//     severity: "info" | "warn" | "error" | "critical",
//     excerpt: string,          // cut from RAW text, never masked text
//     span: { line, start, end }, // start/end are absolute char offsets into the linted text
//     message: string,          // why this fired (was `detail` in lint.py)
//     suggestion: string | null,
//     relatedLines?: number[],  // other lines behind the same document-wide finding
//     status?: "new" | "persisting", // set only when --baseline is used
//   }

/** `対応箇所: L12, L34, ...` — mirrors format_related_lines() in lint.py. */
export function formatRelatedLines(relatedLines) {
  const uniqSorted = [...new Set(relatedLines)].sort((a, b) => a - b);
  return "対応箇所: " + uniqSorted.map((n) => `L${n}`).join(", ");
}

// Short, actionable per-category suggestions. Categories with no entry get
// `null` (the `message` already explains the finding well enough on its
// own, e.g. one-off statistical findings).
const SUGGESTIONS = {
  forbidden_phrase: "定型句を削除するか、具体的な内容に置き換える",
  translationese: "直訳調の言い回しを日本語として自然な語順・表現に書き換える",
  translationese_morph: "「〜することができる」型の言い回しを言い切りに書き換える",
  antithesis_repetition: "「〜ではなく」「〜だけでなく」の対比表現の使用回数を減らす",
  low_sentence_variance: "文の長短を意図的に混ぜてリズムを作る",
  english_syntax_inanimate_subject: "無生物主語を人や組織を主語にした文に書き換える",
  english_syntax_cleft_because: "「それは〜である。なぜなら〜」型の強調構文を平叙文に崩す",
  inanimate_subject_morph: "無生物主語を人や組織を主語にした文に書き換える",
  nominal_ending: "体言止めを一部に使い、文末のリズムに変化をつける",
  paragraph_lead_conjunction: "段落冒頭の接続詞を減らし、内容そのもので繋ぐ",
  uniform_paragraph_structure: "段落の長さ（文数）にばらつきを持たせる",
  low_burstiness: "短文と長文を意図的に混在させる",
  high_length_autocorrelation: "隣接する文の長さパターンを崩す",
  repeated_sentence_lead: "文頭の書き出しを変える",
  repeated_syntax_template: "文の構文パターンを変える",
  low_lexical_diversity_ttr: "同じ語彙の言い換えを増やす",
  low_lexical_diversity_mtld: "同じ語彙の言い換えを増やす",
  low_specificity: "固有名詞・数値・具体例を追加する（文体ではなく素材不足のサイン）",
  high_bold_density: "太字の使用箇所を絞る",
  high_bullet_ratio: "箇条書きの一部を地の文に戻す",
  boilerplate_heading: "定型見出しを内容が分かる見出しに変える",
  numbered_phase_structure: "機械的な番号付け構造を減らす",
  high_emoji_symbol_density: "絵文字・装飾記号を減らす",
  long_sentence: "文を分割する",
  nested_parentheses: "括弧注釈を減らすか、文を分割して本文に統合する",
};

export function suggestionFor(category) {
  return SUGGESTIONS[category] ?? null;
}

/** Builds a Finding. `span.line` plus absolute `start`/`end` offsets (pass
 * the same value for both when a detector has no exact match position,
 * e.g. whole-document statistics). */
export function makeFinding({ category, severity, excerpt, line, start, end, message, relatedLines }) {
  const finding = {
    category,
    severity,
    excerpt,
    span: { line, start, end },
    message,
    suggestion: suggestionFor(category),
  };
  if (relatedLines && relatedLines.length) {
    finding.relatedLines = [...new Set(relatedLines)].sort((a, b) => a - b);
  }
  return finding;
}
