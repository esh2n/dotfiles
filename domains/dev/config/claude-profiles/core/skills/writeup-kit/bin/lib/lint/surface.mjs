// surface.mjs — the 6 surface-level (regex-only, no tokenizer) detectors,
// plus the 2 new counters the contract (§5) asks lint to also expose:
// long_sentence and nested_parentheses. This whole file is what
// `--surface-only` runs (the 作業メモ / work-note gate scope, per
// references/page-contract.md §8).
//
// Ported from natural-japanese's scripts/lint.py:
//   detect_forbidden_phrases, detect_translationese,
//   detect_antithesis_repetition, detect_low_sentence_length_variance,
//   detect_english_syntax_smell, detect_structural_ai_habits.
// Word lists, regexes, and thresholds are unchanged from the Python
// original — none of these 6 detectors depend on tokenizer granularity.

import { HEADING_RE, LIST_ITEM_RE, iterLinesWithNo, lineColToOffset } from "../text.mjs";
import { makeFinding, formatRelatedLines } from "./finding.mjs";

// ---------------------------------------------------------------------------
// Word lists / patterns (verbatim port of lint.py's module-level constants)
// ---------------------------------------------------------------------------

export const FORBIDDEN_PHRASES = [
  "と言えるでしょう",
  "と言えるだろう",
  "と言えます",
  "ということになるでしょう",
  "のではないでしょうか",
  "重要なのは",
  "大切なのは",
  "ポイントは",
  "結論から言うと",
  "結論として",
  "いかがでしたか",
  "いかがでしょうか",
  "まとめると",
  "総じて",
  "非常に重要",
  "極めて重要",
  "言うまでもなく",
  "言うまでもありません",
  "まさしく",
  "さて、",
  "それでは、",
  "このように",
  "このような中",
  "ここで注目したいのは",
  "見ていきましょう",
  "紹介していきます",
  "解説していきます",
  "深掘りしていきます",
  "一概には言えません",
  "個人差がありますが",
  "あくまで一例ですが",
  "正面から扱う",
  "正面から見る",
  "正面から書く",
  "正面から立てる",
  "正面から回収する",
  "不可欠",
  "核心的",
  "鍵となる",
  "根本的な",
  "多角的",
  "包括的",
  "総合的",
  "掘り下げる",
  "深掘りする",
  "言語化する",
  "について見ていく",
  "を探求する",
];

export const FORBIDDEN_PHRASES_WEAK_SIGNAL = new Set(["重要なのは", "このように", "不可欠", "ポイントは", "さて、"]);

export const TRANSLATIONESE_PATTERNS = [
  /することができ(る|ます|た)/g,
  /することが可能(です|だ|になる)/g,
  /と言えるだろう/g,
  /という点で/g,
  /という観点(から|で)/g,
  /にとって(重要|不可欠)/g,
  /を持つ(こと|存在)/g,
  /することによって/g,
  /であることは間違いない/g,
  /に他ならない/g,
];

const ANTITHESIS_PATTERNS = [/ではなく、?.{0,30}/g, /だけでなく.{0,10}も/g];

export const ANTITHESIS_REPETITION_THRESHOLD = 3;
export const ANTITHESIS_RATE_INFO_BELOW = 0.02;
export const ANTITHESIS_RATE_CRITICAL_ABOVE = 0.03;

export const SENTENCE_VARIANCE_MIN_SENTENCES = 5;
export const SENTENCE_VARIANCE_CV_THRESHOLD = 0.25;

const INANIMATE_SUBJECT_PATTERNS = [
  /(これ|それ|この事実|そのこと)(は|が).{0,40}(もたらす|示す|意味する|証明する|生み出す|反映する)/g,
  /.{0,20}(こと|事実)(は|が).{0,40}(もたらす|示す|意味する|証明する|生み出す|反映する)/g,
];
const CLEFT_BECAUSE_HEAD = /^(それ|これ|この)は.{0,60}(である|だ)$/;
const BECAUSE_HEAD = /^(なぜなら|というのも)/;

// New (contract §5): sentence-length and parenthetical-annotation counters.
export const LONG_SENTENCE_WARN_CHARS = 80;
export const LONG_SENTENCE_ERROR_CHARS = 120;
export const NESTED_PARENTHESES_MIN_COUNT = 2;
const PAREN_RE = /\([^()]*\)|（[^（）]*）/g;

// Structural (Markdown-level) habit detectors — EXPERIMENTAL, see index.mjs.
const BOLD_SPAN_RE = /\*\*[^*\n]+\*\*/g;
const BOLD_DENSITY_PER_1000_THRESHOLD = 3.0;
const BULLET_LINE_RATIO_THRESHOLD = 0.35;
const BULLET_LINE_MIN_LINES = 10;
const BOILERPLATE_HEADING_WORDS = ["まとめ", "おわりに", "終わりに", "さいごに", "最後に", "結論", "総括", "conclusion"];
const NUMBERED_PHASE_RE = /(フェーズ|ステップ|段階|ステージ)\s*[0-90-9１-９]/g;
const NUMBERED_PHASE_MIN_COUNT = 3;
const EMOJI_SYMBOL_RE = /[\u{1F300}-\u{1FAFF}☀-➿⭐✅❌❗❓]/gu;
const EMOJI_SYMBOL_PER_1000_THRESHOLD = 2.0;

function rawOrMasked(rawLinesByNo, no, fallback) {
  if (!rawLinesByNo) return fallback;
  return rawLinesByNo.has(no) ? rawLinesByNo.get(no) : fallback;
}

// ---------------------------------------------------------------------------
// 1) forbidden_phrase
// ---------------------------------------------------------------------------
export function detectForbiddenPhrases(lines, rawLinesByNo, lineOffsets) {
  const findings = [];
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const phrase of FORBIDDEN_PHRASES) {
      const idx = line.indexOf(phrase);
      if (idx !== -1) {
        const start = Math.max(0, idx - 10);
        const end = idx + phrase.length + 10;
        const excerpt = (rawLine.length >= end ? rawLine.slice(start, end) : line.slice(start, end)).trim();
        const isWeak = FORBIDDEN_PHRASES_WEAK_SIGNAL.has(phrase);
        const severity = isWeak ? "info" : "warn";
        let message = `禁止語/LLM常套句ヒット: 「${phrase}」`;
        if (isWeak) message += "（コーパス校正で人間側にも一定数出現する弱いシグナルと判定、severity低下）";
        findings.push(
          makeFinding({
            category: "forbidden_phrase",
            severity,
            excerpt,
            line: no,
            start: lineColToOffset(lineOffsets, no, idx),
            end: lineColToOffset(lineOffsets, no, idx + phrase.length),
            message,
          })
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 2) translationese (surface)
// ---------------------------------------------------------------------------
export function detectTranslationese(lines, rawLinesByNo, lineOffsets) {
  const findings = [];
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const pat of TRANSLATIONESE_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(line)) !== null) {
        const start = Math.max(0, m.index - 10);
        const end = m.index + m[0].length + 10;
        const excerpt = (rawLine.length >= end ? rawLine.slice(start, end) : line.slice(start, end)).trim();
        findings.push(
          makeFinding({
            category: "translationese",
            severity: "info",
            excerpt,
            line: no,
            start: lineColToOffset(lineOffsets, no, m.index),
            end: lineColToOffset(lineOffsets, no, m.index + m[0].length),
            message: `翻訳調パターン: /${pat.source}/ に一致`,
          })
        );
        if (m[0].length === 0) pat.lastIndex++;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3) antithesis_repetition
// ---------------------------------------------------------------------------
export function detectAntithesisRepetition(
  lines,
  rawLinesByNo,
  lineOffsets,
  totalSentences,
  {
    threshold = ANTITHESIS_REPETITION_THRESHOLD,
    rateInfoBelow = ANTITHESIS_RATE_INFO_BELOW,
    rateCriticalAbove = ANTITHESIS_RATE_CRITICAL_ABOVE,
  } = {}
) {
  const hits = []; // { no, excerpt, start, end }
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const pat of ANTITHESIS_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(line)) !== null) {
        const excerpt = rawLine.length >= m.index + m[0].length ? rawLine.slice(m.index, m.index + m[0].length) : m[0];
        hits.push({ no, excerpt, start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) pat.lastIndex++;
      }
    }
  }

  const findings = [];
  if (hits.length >= threshold) {
    const ratio = totalSentences ? hits.length / totalSentences : 0;
    let severity;
    if (ratio < rateInfoBelow) severity = "info";
    else if (ratio >= rateCriticalAbove) severity = "critical";
    else severity = "warn";

    const allLines = hits.map((h) => h.no);
    const related = formatRelatedLines(allLines);
    for (const h of hits) {
      findings.push(
        makeFinding({
          category: "antithesis_repetition",
          severity,
          excerpt: h.excerpt.trim(),
          line: h.no,
          start: lineColToOffset(lineOffsets, h.no, h.start),
          end: lineColToOffset(lineOffsets, h.no, h.end),
          message: `否定→肯定対比パターンが文書内で${hits.length}回検出（閾値${threshold}回以上、総文数に対する比率=${(ratio * 100).toFixed(1)}%）。${related}`,
          relatedLines: allLines,
        })
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 4) low_sentence_variance
// ---------------------------------------------------------------------------
export function detectLowSentenceLengthVariance(
  sentences,
  lineOffsets,
  { threshold = SENTENCE_VARIANCE_CV_THRESHOLD, minSentences = SENTENCE_VARIANCE_MIN_SENTENCES } = {}
) {
  const lengths = sentences.map(([, s]) => s.length).filter((n) => n > 0);
  if (lengths.length < minSentences) return [];
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean === 0) return [];
  const variance = lengths.reduce((acc, n) => acc + (n - mean) ** 2, 0) / lengths.length;
  const stdev = Math.sqrt(variance);
  const cv = stdev / mean;
  if (cv < threshold) {
    const firstLine = sentences.length ? sentences[0][0] : 1;
    return [
      makeFinding({
        category: "low_sentence_variance",
        severity: "warn",
        excerpt: `文数=${lengths.length}, 平均文長=${mean.toFixed(1)}字, 変動係数=${cv.toFixed(3)}`,
        line: firstLine,
        start: lineColToOffset(lineOffsets, firstLine, 0),
        end: lineColToOffset(lineOffsets, firstLine, 0),
        message: `文長の変動係数が閾値(${threshold})未満。リズムが均質でAI臭い可能性`,
      }),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 5) english_syntax_smell (surface): inanimate subject regex + cleft-because
// ---------------------------------------------------------------------------
export function detectEnglishSyntaxSmell(lines, rawLinesByNo, sentences, lineOffsets) {
  const findings = [];
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const pat of INANIMATE_SUBJECT_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(line)) !== null) {
        const excerpt = rawLine.length >= m.index + m[0].length ? rawLine.slice(m.index, m.index + m[0].length) : m[0];
        findings.push(
          makeFinding({
            category: "english_syntax_inanimate_subject",
            severity: "info",
            excerpt,
            line: no,
            start: lineColToOffset(lineOffsets, no, m.index),
            end: lineColToOffset(lineOffsets, no, m.index + m[0].length),
            message: "無生物主語+他動詞的述語（表層パターン、英語統語の直訳調の可能性、要人間判断）",
          })
        );
        if (m[0].length === 0) pat.lastIndex++;
      }
    }
  }

  for (let i = 0; i < sentences.length - 1; i++) {
    const [no1, s1, r1] = sentences[i];
    const [, s2, r2] = sentences[i + 1];
    if (CLEFT_BECAUSE_HEAD.test(s1) && BECAUSE_HEAD.test(s2)) {
      findings.push(
        makeFinding({
          category: "english_syntax_cleft_because",
          severity: "warn",
          excerpt: `${r1}。${r2}`,
          line: no1,
          start: lineColToOffset(lineOffsets, no1, 0),
          end: lineColToOffset(lineOffsets, no1, 0),
          message: "「それは〜である。なぜなら〜だ」型の強調構文（英語 It is ... because ... の直訳調）",
        })
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 6) structural_ai_habits (raw Markdown text, pre-mask) — all EXPERIMENTAL
// ---------------------------------------------------------------------------
export function detectStructuralAiHabits(rawText) {
  const findings = [];
  const rawLines = iterLinesWithNo(rawText);
  const totalChars = rawText.length || 1;
  const lineStartOf = (offset) => rawText.slice(0, offset).split("\n").length;

  // 1) bold density
  const boldHits = [...rawText.matchAll(BOLD_SPAN_RE)];
  const boldPer1000 = (boldHits.length / totalChars) * 1000;
  if (boldPer1000 >= BOLD_DENSITY_PER_1000_THRESHOLD && boldHits.length >= 3) {
    const firstLine = lineStartOf(boldHits[0].index);
    findings.push(
      makeFinding({
        category: "high_bold_density",
        severity: "info",
        excerpt: `太字スパン${boldHits.length}箇所（1000字あたり${boldPer1000.toFixed(2)}）`,
        line: firstLine,
        start: boldHits[0].index,
        end: boldHits[0].index,
        message: `太字（**...**）の使用密度が閾値（1000字あたり${BOLD_DENSITY_PER_1000_THRESHOLD}）以上。強調の多用は教科書的なAI生成文に見られる傾向（実験的検出器、閾値は暫定）`,
      })
    );
  }

  // 2) bullet line ratio
  const nonBlankLines = rawLines.filter(([, line]) => line.trim());
  const bulletLines = nonBlankLines.filter(([, line]) => LIST_ITEM_RE.test(line)).map(([no]) => no);
  if (nonBlankLines.length >= BULLET_LINE_MIN_LINES) {
    const bulletRatio = bulletLines.length / nonBlankLines.length;
    if (bulletRatio >= BULLET_LINE_RATIO_THRESHOLD) {
      const firstLine = bulletLines.length ? bulletLines[0] : 1;
      findings.push(
        makeFinding({
          category: "high_bullet_ratio",
          severity: "info",
          excerpt: `箇条書き行${bulletLines.length}/${nonBlankLines.length}行（${(bulletRatio * 100).toFixed(1)}%）`,
          line: firstLine,
          start: 0,
          end: 0,
          message: `箇条書き行の比率が閾値${(BULLET_LINE_RATIO_THRESHOLD * 100).toFixed(0)}%以上。文章より箇条書きに頼る構成は教科書的なAI生成文に見られる傾向（実験的検出器）`,
          relatedLines: bulletLines.length > 1 ? bulletLines : undefined,
        })
      );
    }
  }

  // 3) boilerplate heading
  for (const [no, line] of rawLines) {
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const headingText = line.slice(m[0].length).trim().toLowerCase();
    for (const word of BOILERPLATE_HEADING_WORDS) {
      if (headingText.startsWith(word.toLowerCase())) {
        findings.push(
          makeFinding({
            category: "boilerplate_heading",
            severity: "info",
            excerpt: line.trim().slice(0, 40),
            line: no,
            start: 0,
            end: 0,
            message: `定型見出し「${word}」系での締め。予告・構成の型のみで中身を語らない教科書的なAI生成文に見られる傾向（実験的検出器）`,
          })
        );
        break;
      }
    }
  }

  // 4) numbered phase structure
  const phaseHits = [...rawText.matchAll(NUMBERED_PHASE_RE)];
  if (phaseHits.length >= NUMBERED_PHASE_MIN_COUNT) {
    const firstLine = lineStartOf(phaseHits[0].index);
    findings.push(
      makeFinding({
        category: "numbered_phase_structure",
        severity: "info",
        excerpt: `番号付きフェーズ表現が${phaseHits.length}回出現`,
        line: firstLine,
        start: phaseHits[0].index,
        end: phaseHits[0].index,
        message: `「フェーズ/ステップ/段階+番号」の表現が閾値${NUMBERED_PHASE_MIN_COUNT}回以上。機械的な段階分割は教科書的なAI生成文に見られる傾向（実験的検出器）`,
      })
    );
  }

  // 5) emoji / decorative symbol density
  const emojiHits = [...rawText.matchAll(EMOJI_SYMBOL_RE)];
  const emojiPer1000 = (emojiHits.length / totalChars) * 1000;
  if (emojiPer1000 >= EMOJI_SYMBOL_PER_1000_THRESHOLD && emojiHits.length >= 3) {
    const firstLine = lineStartOf(emojiHits[0].index);
    findings.push(
      makeFinding({
        category: "high_emoji_symbol_density",
        severity: "info",
        excerpt: `絵文字/装飾記号${emojiHits.length}箇所（1000字あたり${emojiPer1000.toFixed(2)}）`,
        line: firstLine,
        start: emojiHits[0].index,
        end: emojiHits[0].index,
        message: `絵文字・装飾記号の使用密度が閾値（1000字あたり${EMOJI_SYMBOL_PER_1000_THRESHOLD}）以上（実験的検出器、閾値は暫定）`,
      })
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 7) long_sentence (NEW — contract §5's 文長 self-check item, exposed here
//    as a lint detector too, per the M3 task brief)
// ---------------------------------------------------------------------------
export function detectLongSentence(sentences, lineOffsets, rawLinesByNo) {
  const findings = [];
  for (const [no, , rawSentence] of sentences) {
    const len = rawSentence.length;
    if (len <= LONG_SENTENCE_WARN_CHARS) continue;
    const severity = len > LONG_SENTENCE_ERROR_CHARS ? "error" : "warn";
    const rawLine = rawOrMasked(rawLinesByNo, no, rawSentence);
    const col = Math.max(0, rawLine.indexOf(rawSentence));
    findings.push(
      makeFinding({
        category: "long_sentence",
        severity,
        excerpt: rawSentence.length > 60 ? rawSentence.slice(0, 57) + "..." : rawSentence,
        line: no,
        start: lineColToOffset(lineOffsets, no, col),
        end: lineColToOffset(lineOffsets, no, col + rawSentence.length),
        message: `文長${len}字（警告閾値${LONG_SENTENCE_WARN_CHARS}字超、エラー閾値${LONG_SENTENCE_ERROR_CHARS}字超）`,
      })
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 8) nested_parentheses (NEW — contract §5's 括弧注釈 self-check item)
// ---------------------------------------------------------------------------
export function detectNestedParentheses(sentences, lineOffsets, rawLinesByNo, { minCount = NESTED_PARENTHESES_MIN_COUNT } = {}) {
  const findings = [];
  for (const [no, , rawSentence] of sentences) {
    const hits = [...rawSentence.matchAll(PAREN_RE)];
    if (hits.length < minCount) continue;
    const rawLine = rawOrMasked(rawLinesByNo, no, rawSentence);
    const col = Math.max(0, rawLine.indexOf(rawSentence));
    findings.push(
      makeFinding({
        category: "nested_parentheses",
        severity: "warn",
        excerpt: rawSentence.length > 60 ? rawSentence.slice(0, 57) + "..." : rawSentence,
        line: no,
        start: lineColToOffset(lineOffsets, no, col),
        end: lineColToOffset(lineOffsets, no, col + rawSentence.length),
        message: `1文に括弧注釈が${hits.length}個（閾値${minCount}個以上で警告）`,
      })
    );
  }
  return findings;
}
