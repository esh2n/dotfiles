// morph.mjs — the 7 tokenizer-dependent detectors. All morphological access
// goes through bin/lib/tokenize.mjs; nothing here calls the wasm binding
// directly.
//
// Ported from natural-japanese's scripts/lint.py:
//   detect_nominal_ending_and_paragraph_conjunctions, detect_translationese_morph,
//   detect_inanimate_subject_morph, detect_rhythm_statistics,
//   detect_ngram_repetition, detect_lexical_diversity, detect_low_specificity.
//
// POS-tag adaptation note: the Python original ran on Sudachi (SplitMode.C,
// "longest unit"), whose top-level tag for punctuation/closing brackets is
// 補助記号 (there is also a separate 空白 tag for whitespace tokens). This
// port runs on IPADIC (via lindera), whose equivalent top-level tag is
// simply 記号 and which does not surface whitespace as its own tag. Every
// other POS/dictionary-form comparison in the ported logic below (名詞,
// 動詞, 助詞, 形容詞, 副詞, 固有名詞, 数, etc.) is identical between the two
// tagsets and needed no change — confirmed by tokenizing each fixture
// sentence through the vendored lindera build during porting.
//
// Granularity note (compound nouns): ngram_repetition, lexical_diversity,
// and low_specificity read `ts.joinedTokens` (IPADIC tokens run through
// tokenize.mjs's joinNounTokens(), approximating Sudachi's longest-unit
// segmentation) instead of `ts.tokens` — see tokenize.mjs's doc comment.
// The other 4 morph detectors match short, fixed function words/phrases
// that segmentation granularity doesn't affect, so they read `ts.tokens`
// (IPADIC's native, unjoined segmentation) directly, matching the
// contract's per-detector 分割粒度 column.

import { tokenize, joinNounTokens } from "../tokenize.mjs";
import { iterParagraphsWithLines, lineColToOffset } from "../text.mjs";
import { makeFinding, formatRelatedLines } from "./finding.mjs";

// ---------------------------------------------------------------------------
// Shared tokenization pass
// ---------------------------------------------------------------------------

/** Tokenizes every (line, maskedSentence, rawSentence) triple once and
 * returns `{ line, text, tokens, joinedTokens, rawText }` records shared by
 * all 7 morph detectors (mirrors lint.py's tokenize_sentences() cache). */
export async function tokenizeSentences(sentences) {
  const result = [];
  for (const [no, sent, rawSent] of sentences) {
    if (!sent) continue;
    const tokens = await tokenize(sent, { joinNouns: false });
    result.push({
      line: no,
      text: sent,
      tokens,
      joinedTokens: joinNounTokens(tokens),
      rawText: rawSent || sent,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Constants (verbatim values from lint.py; tag names adapted per note above)
// ---------------------------------------------------------------------------

const NOUN_ENDING_POS = new Set(["名詞"]);
const TRAILING_SYMBOL_POS = new Set(["記号"]); // Sudachi 補助記号/空白 -> IPADIC 記号
const CONTENT_WORD_POS = new Set(["名詞", "動詞", "形容詞", "副詞"]);

const ABSTRACT_PRONOUNS = new Set(["これ", "それ", "あれ", "それら"]);
const ABSTRACT_PRONOUN_PHRASES = new Set(["この事実", "そのこと"]);
const TRANSITIVE_SMELL_VERBS = new Set([
  "もたらす",
  "示す",
  "意味する",
  "証明する",
  "生み出す",
  "反映する",
  "示唆する",
  "物語る",
  "浮き彫りにする",
  "後押しする",
]);

const PARAGRAPH_CONJUNCTIONS = [
  "しかし",
  "また",
  "そして",
  "そのため",
  "さらに",
  "つまり",
  "一方",
  "一方で",
  "このように",
  "なぜなら",
  "したがって",
  "ただし",
];

export const NOMINAL_ENDING_MIN_SENTENCES = 5;
export const NOMINAL_ENDING_RATIO_THRESHOLD = 0.0;
export const NOMINAL_ENDING_MIN_CHARS = 2000;
export const PARAGRAPH_CONJ_MIN_PARAGRAPHS = 3;
export const PARAGRAPH_CONJ_RATIO_THRESHOLD = 0.3;
export const UNIFORM_PARAGRAPH_MIN_PARAGRAPHS = 4;
export const UNIFORM_PARAGRAPH_CV_THRESHOLD = 0.15;

export const BURSTINESS_MIN_TOKENIZED = 6;
export const BURSTINESS_THRESHOLD = -0.24;
export const AUTOCORR_MIN_XS = 4;
export const AUTOCORR_THRESHOLD = 0.6;

export const NGRAM_LEAD_REPEAT_THRESHOLD = 6;
export const NGRAM_TEMPLATE_MIN_COUNT = 6;
export const NGRAM_TEMPLATE_RATIO_THRESHOLD = 0.4;

export const LEXDIV_MIN_TOKENS = 30;
export const TTR_THRESHOLD = 0.45;
export const MTLD_THRESHOLD = 40;
export const LEXDIV_MIN_DOC_CHARS = 4000;

export const LOW_SPECIFICITY_MIN_CHARS = 80;
export const LOW_SPECIFICITY_MIN_CONTENT_WORDS = 15;
export const LOW_SPECIFICITY_PROPER_NOUN_WEIGHT = 1.0;
export const LOW_SPECIFICITY_NUMERIC_WEIGHT = 1.0;
export const LOW_SPECIFICITY_EXAMPLE_MARKER_BONUS = 0.1;
export const LOW_SPECIFICITY_ABSTRACT_NOUN_WEIGHT = 1.5;
export const LOW_SPECIFICITY_SCORE_THRESHOLD = -0.15;

const ABSTRACT_NOUN_WORDS = new Set([
  "側面",
  "観点",
  "重要性",
  "可能性",
  "あり方",
  "存在",
  "意味",
  "本質",
  "価値",
  "意義",
  "課題",
  "問題",
  "要素",
  "要因",
  "背景",
  "傾向",
  "姿勢",
  "視点",
  "概念",
  "特徴",
  "性質",
  "状況",
  "状態",
  "変化",
]);

const EXAMPLE_MARKER_WORDS = [
  "たとえば",
  "例えば",
  "実際に",
  "実際には",
  "具体的には",
  "具体例として",
  "一例として",
  "先日",
  "昨日",
  "現に",
  "実例として",
];

const NUMERIC_QUANTITY_RE =
  /[0-9０-９]+(年代|年間|世紀|年|月|日|時間|時|分|秒|人|円|%|％|kg|km|cm|mm|g|m|回|件|個|つ|割|倍|台|社|名|冊|本|杯|軒)?/g;

const LATIN_TECH_TOKEN_RE = /^[A-Za-z][A-Za-z0-9\-_.]*$/;

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function pstdev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / arr.length);
}

function stripTrailingSymbols(tokens) {
  let i = tokens.length;
  while (i > 0 && TRAILING_SYMBOL_POS.has(tokens[i - 1].pos[0])) i--;
  return tokens.slice(0, i);
}

// ---------------------------------------------------------------------------
// 7) nominal_ending + paragraph_lead_conjunction + uniform_paragraph_structure
// ---------------------------------------------------------------------------
export function detectNominalEndingAndParagraphConjunctions(
  lines,
  tokenized,
  rawLinesByNo,
  lineOffsets,
  {
    nominalMinSentences = NOMINAL_ENDING_MIN_SENTENCES,
    nominalRatioThreshold = NOMINAL_ENDING_RATIO_THRESHOLD,
    nominalMinChars = NOMINAL_ENDING_MIN_CHARS,
    conjMinParagraphs = PARAGRAPH_CONJ_MIN_PARAGRAPHS,
    conjRatioThreshold = PARAGRAPH_CONJ_RATIO_THRESHOLD,
    uniformMinParagraphs = UNIFORM_PARAGRAPH_MIN_PARAGRAPHS,
    uniformCvThreshold = UNIFORM_PARAGRAPH_CV_THRESHOLD,
  } = {}
) {
  let nominalEndingCount = 0;
  let totalSentences = 0;
  let totalChars = 0;
  let lastLine = 1;

  for (const ts of tokenized) {
    totalSentences++;
    totalChars += ts.rawText.length;
    lastLine = ts.line;
    const effective = stripTrailingSymbols(ts.tokens);
    if (!effective.length) continue;
    const last = effective[effective.length - 1];
    if (NOUN_ENDING_POS.has(last.pos[0])) nominalEndingCount++;
  }

  const ratio = totalSentences ? nominalEndingCount / totalSentences : 0;
  const findings = [];

  if (totalSentences >= nominalMinSentences && totalChars >= nominalMinChars && ratio <= nominalRatioThreshold) {
    findings.push(
      makeFinding({
        category: "nominal_ending",
        severity: "info",
        excerpt: `体言止め0件（全${totalSentences}文、約${totalChars}字）`,
        line: lastLine,
        start: lineColToOffset(lineOffsets, lastLine, 0),
        end: lineColToOffset(lineOffsets, lastLine, 0),
        message:
          "この文書には体言止めが1つもない。ある程度の長さの文書でこの修辞技法が皆無なのはAI文章に特徴的（コーパス実測: essayジャンルで人間60% vs AI 0%が体言止めを使用）。人間的な修辞の欠如の疑い",
      })
    );
  }

  const paragraphs = iterParagraphsWithLines(lines);
  let conjParagraphCount = 0;
  const totalParagraphs = paragraphs.length;
  const conjHits = [];
  const sentenceCountsPerParagraph = [];

  for (const paraLines of paragraphs) {
    const [firstNo, firstLineRaw] = paraLines[0];
    const firstLineText = firstLineRaw.trim();
    const paraJoined = paraLines.map(([, t]) => t).join("\n");
    sentenceCountsPerParagraph.push(paraJoined.split(/[。！？\n]/).filter((p) => p.trim()).length);
    for (const conj of PARAGRAPH_CONJUNCTIONS) {
      if (firstLineText.startsWith(conj)) {
        conjParagraphCount++;
        conjHits.push({ no: firstNo, text: firstLineText, conj });
        break;
      }
    }
  }

  const conjRatio = totalParagraphs ? conjParagraphCount / totalParagraphs : 0;
  if (totalParagraphs >= conjMinParagraphs && conjRatio >= conjRatioThreshold) {
    const conjLines = conjHits.map((h) => h.no);
    const related = formatRelatedLines(conjLines);
    for (const h of conjHits) {
      const excerptSource = rawLinesByNo && rawLinesByNo.has(h.no) ? rawLinesByNo.get(h.no) : h.text;
      findings.push(
        makeFinding({
          category: "paragraph_lead_conjunction",
          severity: "info",
          excerpt: excerptSource.slice(0, 40),
          line: h.no,
          start: lineColToOffset(lineOffsets, h.no, 0),
          end: lineColToOffset(lineOffsets, h.no, 0),
          message: `段落頭が接続詞「${h.conj}」で始まる（文書全体の段落頭接続詞率=${(conjRatio * 100).toFixed(1)}%、閾値${(conjRatioThreshold * 100).toFixed(0)}%以上で警告）。${related}`,
          relatedLines: conjLines,
        })
      );
    }
  }

  let paragraphSentenceCountCv = null;
  if (sentenceCountsPerParagraph.length >= uniformMinParagraphs) {
    const pMean = mean(sentenceCountsPerParagraph);
    const pStd = pstdev(sentenceCountsPerParagraph);
    paragraphSentenceCountCv = pMean ? pStd / pMean : 0;
    if (paragraphSentenceCountCv < uniformCvThreshold) {
      findings.push(
        makeFinding({
          category: "uniform_paragraph_structure",
          severity: "info",
          excerpt: `段落数=${sentenceCountsPerParagraph.length}, 各段落の文数=[${sentenceCountsPerParagraph.join(", ")}]`,
          line: 1,
          start: 0,
          end: 0,
          message: `段落あたり文数の変動係数=${paragraphSentenceCountCv.toFixed(3)}（閾値${uniformCvThreshold}未満）。どの段落もほぼ同じ文数=定型段落（例: 3文段落の量産）の疑い`,
        })
      );
    }
  }

  const stats = {
    totalSentences,
    nominalEndingCount,
    nominalEndingRatio: ratio,
    totalParagraphs,
    paragraphLeadConjunctionCount: conjParagraphCount,
    paragraphLeadConjunctionRatio: conjRatio,
    paragraphSentenceCounts: sentenceCountsPerParagraph,
    paragraphSentenceCountCv,
  };
  return { findings, stats };
}

// ---------------------------------------------------------------------------
// 8) translationese_morph
// ---------------------------------------------------------------------------
export function detectTranslationeseMorph(tokenized) {
  const findings = [];
  for (const ts of tokenized) {
    const tokens = ts.tokens;
    const n = tokens.length;
    for (let i = 0; i < n; i++) {
      if (tokens[i].surface !== "こと" || tokens[i].pos[0] !== "名詞") continue;
      const j = i + 1;
      if (j >= n || tokens[j].pos[0] !== "助詞" || !["が", "は"].includes(tokens[j].surface)) continue;
      const k = j + 1;
      if (k >= n || tokens[k].pos[0] !== "動詞" || !tokens[k].surface.startsWith("でき")) continue;
      const spanStart = tokens[Math.max(0, i - 4)].begin;
      const spanEnd = tokens[k].end;
      const excerpt = ts.rawText.slice(spanStart, spanEnd);
      findings.push(
        makeFinding({
          category: "translationese_morph",
          severity: "info",
          excerpt,
          line: ts.line,
          start: spanStart,
          end: spanEnd,
          message: "品詞列マッチ: 名詞/動詞+こと+が/は+できる型の翻訳調構文",
        })
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 13) inanimate_subject_morph
// ---------------------------------------------------------------------------
export function detectInanimateSubjectMorph(tokenized) {
  const findings = [];
  for (const ts of tokenized) {
    const tokens = ts.tokens;
    const n = tokens.length;
    let skipUntil = -1;
    for (let i = 0; i < n; i++) {
      if (i <= skipUntil) continue;
      let isAbstractSubject = ABSTRACT_PRONOUNS.has(tokens[i].surface) || (tokens[i].pos[0] === "名詞" && ["こと", "事実", "の"].includes(tokens[i].surface));
      let subjectEnd = i;
      if (!isAbstractSubject && i + 1 < n && ABSTRACT_PRONOUN_PHRASES.has(tokens[i].surface + tokens[i + 1].surface)) {
        isAbstractSubject = true;
        subjectEnd = i + 1;
      }
      if (!isAbstractSubject) continue;
      skipUntil = Math.max(skipUntil, subjectEnd);
      const j = subjectEnd + 1;
      if (j >= n || tokens[j].pos[0] !== "助詞" || !["が", "は"].includes(tokens[j].surface)) continue;
      for (let k = j + 1; k < n; k++) {
        if (tokens[k].pos[0] === "動詞" && TRANSITIVE_SMELL_VERBS.has(tokens[k].baseForm)) {
          const spanStart = tokens[Math.max(0, i - 3)].begin;
          const spanEnd = tokens[k].end;
          const excerpt = ts.rawText.slice(spanStart, spanEnd);
          const subjectText = tokens
            .slice(i, subjectEnd + 1)
            .map((t) => t.surface)
            .join("");
          findings.push(
            makeFinding({
              category: "inanimate_subject_morph",
              severity: "info",
              excerpt,
              line: ts.line,
              start: spanStart,
              end: spanEnd,
              message: `品詞列マッチ: 抽象主語「${subjectText}」+ ${tokens[j].surface} + 他動詞的述語「${tokens[k].baseForm}」（英語統語の直訳調の疑い）`,
            })
          );
          break;
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 9) rhythm_statistics (mora-based burstiness + lag-1 autocorrelation)
// ---------------------------------------------------------------------------
const SMALL_KANA_MERGE = new Set(["ァ", "ィ", "ゥ", "ェ", "ォ", "ャ", "ュ", "ョ", "ヮ"]);

export function moraLength(tokens) {
  let total = 0;
  for (const t of tokens) {
    const reading = t.reading || t.surface;
    let count = 0;
    for (const ch of reading) {
      if (SMALL_KANA_MERGE.has(ch) && count > 0) continue;
      count++;
    }
    total += count;
  }
  return total;
}

export function detectRhythmStatistics(
  tokenized,
  { minTokenized = BURSTINESS_MIN_TOKENIZED, burstinessThreshold = BURSTINESS_THRESHOLD, autocorrMinXs = AUTOCORR_MIN_XS, autocorrThreshold = AUTOCORR_THRESHOLD } = {}
) {
  if (tokenized.length < minTokenized) return { findings: [], stats: {} };

  const moraLengths = tokenized.map((ts) => moraLength(ts.tokens));
  const m = mean(moraLengths);
  const std = pstdev(moraLengths);
  const findings = [];
  const burstiness = std + m ? (std - m) / (std + m) : 0;

  const xs = moraLengths.slice(0, -1);
  const ys = moraLengths.slice(1);
  let autocorr = null;
  if (xs.length >= autocorrMinXs && pstdev(xs) > 0 && pstdev(ys) > 0) {
    const mx = mean(xs);
    const my = mean(ys);
    const cov = xs.reduce((acc, a, idx) => acc + (a - mx) * (ys[idx] - my), 0) / xs.length;
    autocorr = cov / (pstdev(xs) * pstdev(ys));
  }

  if (burstiness < burstinessThreshold) {
    findings.push(
      makeFinding({
        category: "low_burstiness",
        severity: "warn",
        excerpt: `burstiness=${burstiness.toFixed(3)} (モーラ近似長 平均=${m.toFixed(1)}, 標準偏差=${std.toFixed(1)})`,
        line: tokenized[0].line,
        start: 0,
        end: 0,
        message: `burstiness が閾値(${burstinessThreshold})未満。文の長短のメリハリが乏しく機械的なリズムの疑い`,
      })
    );
  }
  if (autocorr !== null && autocorr > autocorrThreshold) {
    findings.push(
      makeFinding({
        category: "high_length_autocorrelation",
        severity: "info",
        excerpt: `lag-1 自己相関=${autocorr.toFixed(3)}`,
        line: tokenized[0].line,
        start: 0,
        end: 0,
        message: `隣接する文の長さが強く相関（閾値${autocorrThreshold}超）。文長パターンが単調に繰り返されている疑い`,
      })
    );
  }

  return { findings, stats: { moraMean: m, moraStdev: std, burstiness, lengthAutocorrelationLag1: autocorr } };
}

// ---------------------------------------------------------------------------
// 10) ngram_repetition (uses joinedTokens — 分割粒度対応)
// ---------------------------------------------------------------------------
function isProperNounOrTechTerm(token) {
  const isProperNoun = token.pos[0] === "名詞" && token.pos[1] === "固有名詞";
  const isLatinTech = LATIN_TECH_TOKEN_RE.test(token.surface);
  return isProperNoun || isLatinTech;
}

export function detectNgramRepetition(
  tokenized,
  { leadRepeatThreshold = NGRAM_LEAD_REPEAT_THRESHOLD, templateMinCount = NGRAM_TEMPLATE_MIN_COUNT, templateRatioThreshold = NGRAM_TEMPLATE_RATIO_THRESHOLD } = {}
) {
  const findings = [];

  const leadBigrams = [];
  for (const ts of tokenized) {
    const leadTokens = ts.joinedTokens.slice(0, 2);
    if (leadTokens.length === 2) {
      leadBigrams.push({
        no: ts.line,
        rawText: ts.rawText,
        text: leadTokens.map((t) => t.surface).join(""),
        isTechLead: isProperNounOrTechTerm(leadTokens[0]),
      });
    }
  }

  const bigramCounts = new Map();
  for (const b of leadBigrams) bigramCounts.set(b.text, (bigramCounts.get(b.text) || 0) + 1);

  for (const [bigram, count] of bigramCounts) {
    if (count < leadRepeatThreshold) continue;
    const matching = leadBigrams.filter((b) => b.text === bigram);
    const bigramLines = matching.map((b) => b.no);
    const related = formatRelatedLines(bigramLines);
    for (const b of matching) {
      const detail = b.isTechLead
        ? `文頭2形態素「${bigram}」が${count}回反復（閾値${leadRepeatThreshold}回以上）。固有名詞/技術用語由来の可能性が高い。${related}`
        : `文頭2形態素「${bigram}」が${count}回反復（閾値${leadRepeatThreshold}回以上）。人間の意図的な反復技法との区別がつかないため参考情報として提示。${related}`;
      findings.push(
        makeFinding({
          category: "repeated_sentence_lead",
          severity: "info",
          excerpt: b.rawText.slice(0, 20),
          line: b.no,
          start: 0,
          end: 0,
          message: detail,
          relatedLines: bigramLines,
        })
      );
    }
  }

  const leadPosNgrams = [];
  for (const ts of tokenized) {
    const posSeq = ts.joinedTokens.slice(0, 4).map((t) => t.pos[0]);
    if (posSeq.length === 4) leadPosNgrams.push({ no: ts.line, rawText: ts.rawText, seq: posSeq.join("/") });
  }
  const totalWithNgram = leadPosNgrams.length;
  const posCounts = new Map();
  for (const p of leadPosNgrams) posCounts.set(p.seq, (posCounts.get(p.seq) || 0) + 1);

  let stats = { leadPos4gramTop: null, leadPos4gramRatio: null };
  if (totalWithNgram >= templateMinCount && posCounts.size > 0) {
    let topSeq = null;
    let topCount = -1;
    for (const [seq, c] of posCounts) {
      if (c > topCount) {
        topSeq = seq;
        topCount = c;
      }
    }
    const ratio = topCount / totalWithNgram;
    stats = { leadPos4gramTop: topSeq, leadPos4gramRatio: ratio };
    if (ratio >= templateRatioThreshold) {
      const templateLines = leadPosNgrams.filter((p) => p.seq === topSeq).map((p) => p.no);
      const related = formatRelatedLines(templateLines);
      for (const p of leadPosNgrams) {
        if (p.seq !== topSeq) continue;
        findings.push(
          makeFinding({
            category: "repeated_syntax_template",
            severity: "info",
            excerpt: p.rawText.slice(0, 20),
            line: p.no,
            start: 0,
            end: 0,
            message: `文頭品詞4-gram「${topSeq}」が全文の${(ratio * 100).toFixed(1)}%で一致（閾値${(templateRatioThreshold * 100).toFixed(0)}%以上）。構文テンプレートの使い回しの疑い。${related}`,
            relatedLines: templateLines,
          })
        );
      }
    }
  }

  return { findings, stats };
}

// ---------------------------------------------------------------------------
// 11) lexical_diversity (TTR / MTLD, uses joinedTokens — 分割粒度対応)
// ---------------------------------------------------------------------------
export function computeMtld(tokens, threshold = 0.72) {
  if (tokens.length < 20) return null;

  const factorsOneDirection = (seq) => {
    let factorCount = 0;
    let types = new Set();
    let tokenCount = 0;
    for (const tok of seq) {
      types.add(tok);
      tokenCount++;
      const ttr = types.size / tokenCount;
      if (ttr <= threshold) {
        factorCount++;
        types = new Set();
        tokenCount = 0;
      }
    }
    if (tokenCount > 0) {
      const typesTtr = tokenCount ? types.size / tokenCount : 1.0;
      const partial = typesTtr < 1 ? (1 - typesTtr) / (1 - threshold) : 0.0;
      factorCount += Math.min(partial, 1.0);
    }
    return factorCount > 0 ? seq.length / factorCount : seq.length;
  };

  const forward = factorsOneDirection(tokens);
  const backward = factorsOneDirection([...tokens].reverse());
  return (forward + backward) / 2;
}

export function detectLexicalDiversity(
  tokenized,
  { minTokens = LEXDIV_MIN_TOKENS, ttrThreshold = TTR_THRESHOLD, mtldThreshold = MTLD_THRESHOLD, minDocChars = LEXDIV_MIN_DOC_CHARS } = {}
) {
  const contentTokens = [];
  const totalDocChars = tokenized.reduce((acc, ts) => acc + ts.rawText.length, 0);
  for (const ts of tokenized) {
    for (const t of ts.joinedTokens) {
      if (CONTENT_WORD_POS.has(t.pos[0])) contentTokens.push(t.baseForm);
    }
  }

  const findings = [];
  const stats = { ttr: null, mtld: null, contentTokenCount: contentTokens.length, docCharCount: totalDocChars, skippedTooShort: false };

  if (totalDocChars < minDocChars) {
    stats.skippedTooShort = true;
    return { findings, stats };
  }
  if (contentTokens.length >= minTokens) {
    const uniqueCount = new Set(contentTokens).size;
    const ttr = uniqueCount / contentTokens.length;
    const mtld = computeMtld(contentTokens);
    stats.ttr = ttr;
    stats.mtld = mtld;
    const firstLine = tokenized[0].line;
    if (ttr < ttrThreshold) {
      findings.push(
        makeFinding({
          category: "low_lexical_diversity_ttr",
          severity: "info",
          excerpt: `TTR=${ttr.toFixed(3)} (内容語 ${contentTokens.length} 語中 ${uniqueCount} 種類)`,
          line: firstLine,
          start: 0,
          end: 0,
          message: `TTR(Type-Token Ratio)が閾値${ttrThreshold}未満。同じ語彙の使い回しが多い疑い`,
        })
      );
    }
    if (mtld !== null && mtld < mtldThreshold) {
      findings.push(
        makeFinding({
          category: "low_lexical_diversity_mtld",
          severity: "info",
          excerpt: `MTLD=${mtld.toFixed(1)}`,
          line: firstLine,
          start: 0,
          end: 0,
          message: `MTLD が閾値${mtldThreshold}未満。文章長で正規化した語彙多様性が低い疑い`,
        })
      );
    }
  }
  return { findings, stats };
}

// ---------------------------------------------------------------------------
// 12) low_specificity (uses joinNouns:true tokenization — 分割粒度対応)
// ---------------------------------------------------------------------------
export async function detectLowSpecificity(
  lines,
  rawLinesByNo,
  lineOffsets,
  {
    minChars = LOW_SPECIFICITY_MIN_CHARS,
    minContentWords = LOW_SPECIFICITY_MIN_CONTENT_WORDS,
    properNounWeight = LOW_SPECIFICITY_PROPER_NOUN_WEIGHT,
    numericWeight = LOW_SPECIFICITY_NUMERIC_WEIGHT,
    exampleMarkerBonus = LOW_SPECIFICITY_EXAMPLE_MARKER_BONUS,
    abstractNounWeight = LOW_SPECIFICITY_ABSTRACT_NOUN_WEIGHT,
    scoreThreshold = LOW_SPECIFICITY_SCORE_THRESHOLD,
  } = {}
) {
  const findings = [];
  const paragraphs = iterParagraphsWithLines(lines);
  let evaluated = 0;
  let fired = 0;

  for (const paraLines of paragraphs) {
    const [firstNo, firstLineText] = paraLines[0];
    const paraMasked = paraLines.map(([, t]) => t).join("\n");
    if (paraMasked.length < minChars) continue;

    const tokens = await tokenize(paraMasked, { joinNouns: true });
    const contentWords = tokens.filter((t) => CONTENT_WORD_POS.has(t.pos[0]));
    if (contentWords.length < minContentWords) continue;

    evaluated++;

    const properNounCount = contentWords.filter((t) => t.pos[0] === "名詞" && t.pos[1] === "固有名詞").length;
    const abstractNounCount = contentWords.filter((t) => t.pos[0] === "名詞" && ABSTRACT_NOUN_WORDS.has(t.baseForm)).length;
    const numericHitCount = [...paraMasked.matchAll(NUMERIC_QUANTITY_RE)].length;
    const hasExampleMarker = EXAMPLE_MARKER_WORDS.some((w) => paraMasked.includes(w));

    const nContent = contentWords.length;
    const properNounDensity = properNounCount / nContent;
    const numericDensity = numericHitCount / nContent;
    const abstractNounRatio = abstractNounCount / nContent;

    const score = properNounDensity * properNounWeight + numericDensity * numericWeight + (hasExampleMarker ? exampleMarkerBonus : 0.0) - abstractNounRatio * abstractNounWeight;

    if (score < scoreThreshold) {
      fired++;
      const excerptSource = rawLinesByNo && rawLinesByNo.has(firstNo) ? rawLinesByNo.get(firstNo) : firstLineText;
      findings.push(
        makeFinding({
          category: "low_specificity",
          severity: "info",
          excerpt: excerptSource.trim().slice(0, 40),
          line: firstNo,
          start: lineColToOffset(lineOffsets, firstNo, 0),
          end: lineColToOffset(lineOffsets, firstNo, 0),
          message: `段落の具体性スコア=${score.toFixed(3)}（閾値${scoreThreshold}未満）。固有名詞密度=${properNounDensity.toFixed(3)}, 数値密度=${numericDensity.toFixed(3)}, 抽象名詞率=${abstractNounRatio.toFixed(3)}, 例示マーカー=${hasExampleMarker ? "あり" : "なし"}。固有名詞・数値・実例が乏しく一般論に留まっている疑い。素材不足のサインであり、文体の修正でなく情報収集を検討する`,
        })
      );
    }
  }

  return { findings, stats: { paragraphsEvaluated: evaluated, paragraphsFired: fired } };
}
