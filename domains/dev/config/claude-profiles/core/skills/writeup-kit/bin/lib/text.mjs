// text.mjs — sentence splitting, Markdown/HTML structure masking, and file
// reading shared by the lint detectors. Ported from natural-japanese's
// textcore.py (mask_markdown_structure / mask_html_comments /
// split_sentences_with_lines / iter_paragraphs_with_lines / read_source_file).
//
// Masking replaces non-prose regions (headings, list markers, code fences,
// tables, front matter, inline code spans, link URLs) with same-length
// blanks so line numbers and in-line character offsets never shift between
// the "masked" text detectors pattern-match against and the "raw" text
// excerpts are cut from.

import fs from "node:fs";

export const HEADING_RE = /^\s*#{1,6}(\s|$)/;
export const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])(\s|$)/;
const BLOCKQUOTE_RE = /^\s*>/;
const CODE_FENCE_RE = /^\s*(`{3,}|~{3,})/;
const TABLE_ROW_RE = /^\s*\|.*\|/;
const TABLE_DELIMITER_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/;
const FRONT_MATTER_DELIM_RE = /^---\s*$/;
const INLINE_CODE_SPAN_RE = /``(?:[^`\n]|`(?!`))+``|`[^`\n]+`/g;
const MARKDOWN_LINK_URL_RE = /(\]\()([^)]*)(\))/g;

export const SENTENCE_SPLIT_RE = /[。！？\n]/g;

/** 1-indexed [lineNo, line] pairs, matching Python's `str.splitlines()`. */
export function iterLinesWithNo(text) {
  const lines = text.split("\n");
  // Python's splitlines() drops a single trailing newline's empty final
  // element; text.split("\n") does not, so mirror that behavior when the
  // input ends with "\n".
  if (lines.length > 1 && lines[lines.length - 1] === "" && text.endsWith("\n")) {
    lines.pop();
  }
  return lines.map((line, i) => [i + 1, line]);
}

/** Groups line pairs into paragraphs (blank-line separated), same shape in. */
export function iterParagraphsWithLines(lines) {
  const paragraphs = [];
  let current = [];
  for (const [no, line] of lines) {
    if (line.trim()) {
      current.push([no, line]);
    } else if (current.length) {
      paragraphs.push(current);
      current = [];
    }
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

function maskHtmlCommentsInLine(line, inComment) {
  let out = "";
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (inComment) {
      const close = line.indexOf("-->", i);
      if (close === -1) {
        out += " ".repeat(n - i);
        i = n;
      } else {
        const end = close + 3;
        out += " ".repeat(end - i);
        i = end;
        inComment = false;
      }
    } else {
      const start = line.indexOf("<!--", i);
      if (start === -1) {
        out += line.slice(i);
        i = n;
      } else {
        out += line.slice(i, start);
        i = start;
        inComment = true;
      }
    }
  }
  return [out, inComment];
}

/** Blanks HTML comments only; leaves Markdown structure untouched (used by
 * detect_structural_ai_habits, which analyzes raw Markdown structure). */
export function maskHtmlComments(text) {
  const lines = text.split("\n");
  let inComment = false;
  const masked = lines.map((line) => {
    const [m, next] = maskHtmlCommentsInLine(line, inComment);
    inComment = next;
    return m;
  });
  return masked.join("\n");
}

function blankInlineCodeSpans(line) {
  line = line.replace(INLINE_CODE_SPAN_RE, (m) => " ".repeat(m.length));
  line = line.replace(MARKDOWN_LINK_URL_RE, (_, pre, url, post) => pre + " ".repeat(url.length) + post);
  return line;
}

/**
 * Blanks headings, list items, blockquotes, code fences/fenced content,
 * table rows/delimiters, YAML front matter, HTML comments, inline code
 * spans, and link/image URLs — replacing each with same-length whitespace
 * (or, for whole structural lines, an empty string) so line numbers and
 * offsets are preserved. This is the text detectors pattern-match against;
 * excerpts for reports are always cut from the untouched raw text at the
 * same offsets.
 */
export function maskMarkdownStructure(text) {
  const lines = text.split("\n");
  const masked = [];
  let openFence = null; // { ch, len } | null
  let inFrontMatter = false;
  let inHtmlComment = false;

  lines.forEach((line, idx) => {
    if (idx === 0 && FRONT_MATTER_DELIM_RE.test(line)) {
      inFrontMatter = true;
      masked.push("");
      return;
    }
    if (inFrontMatter) {
      masked.push("");
      if (FRONT_MATTER_DELIM_RE.test(line)) inFrontMatter = false;
      return;
    }

    const fenceMatch = line.match(CODE_FENCE_RE);
    if (fenceMatch) {
      const fenceRun = fenceMatch[1];
      const fenceChar = fenceRun[0];
      const fenceLen = fenceRun.length;
      const remainder = line.slice(fenceMatch[0].length);
      const isCloseEligible = remainder.trim() === "";
      if (openFence === null) {
        openFence = { ch: fenceChar, len: fenceLen };
      } else if (fenceChar === openFence.ch && fenceLen >= openFence.len && isCloseEligible) {
        openFence = null;
      }
      masked.push("");
      return;
    }
    if (openFence !== null) {
      masked.push("");
      return;
    }

    const [afterComment, nextInComment] = maskHtmlCommentsInLine(line, inHtmlComment);
    inHtmlComment = nextInComment;
    line = afterComment;

    if (
      HEADING_RE.test(line) ||
      LIST_ITEM_RE.test(line) ||
      BLOCKQUOTE_RE.test(line) ||
      (TABLE_ROW_RE.test(line) && (line.match(/\|/g) || []).length >= 2) ||
      TABLE_DELIMITER_RE.test(line)
    ) {
      masked.push("");
      return;
    }
    masked.push(blankInlineCodeSpans(line));
  });

  return masked.join("\n");
}

/**
 * Splits masked lines into sentences on 。！？ and newlines, returning
 * [lineNo, maskedSentence, rawSentence] triples. `rawLinesByNo` supplies the
 * untouched line for the same lineNo so excerpts are cut from raw text at
 * the same offset the masked match was found at.
 */
export function splitSentencesWithLines(lines, rawLinesByNo = null) {
  const sentences = [];
  for (const [no, line] of lines) {
    const rawLine = rawLinesByNo && rawLinesByNo.has(no) ? rawLinesByNo.get(no) : line;
    const bounds = [];
    let prev = 0;
    SENTENCE_SPLIT_RE.lastIndex = 0;
    let m;
    while ((m = SENTENCE_SPLIT_RE.exec(line)) !== null) {
      bounds.push([prev, m.index]);
      prev = m.index + m[0].length;
      if (m[0].length === 0) SENTENCE_SPLIT_RE.lastIndex++;
    }
    bounds.push([prev, line.length]);
    for (const [s, e] of bounds) {
      const piece = line.slice(s, e);
      if (piece.trim()) {
        const rawPiece = rawLine.length >= e ? rawLine.slice(s, e) : piece;
        sentences.push([no, piece.trim(), rawPiece.trim()]);
      }
    }
  }
  return sentences;
}

/** Cumulative character offset of the start of each 1-indexed line, so a
 * (lineNo, columnInLine) pair can be converted into an absolute offset into
 * the whole document for `span`. */
export function buildLineOffsets(text) {
  const lines = text.split("\n");
  const offsets = [0];
  let acc = 0;
  for (const line of lines) {
    acc += line.length + 1; // +1 for the "\n" that split() consumed
    offsets.push(acc);
  }
  return offsets; // offsets[lineNo - 1] == absolute offset of that line's start
}

export function lineColToOffset(lineOffsets, lineNo, col) {
  const base = lineOffsets[lineNo - 1] ?? 0;
  return base + col;
}

/**
 * Reads `path` as UTF-8. Returns { text, error }; `error` is a
 * human-readable Japanese message (matching the Python original) when the
 * path doesn't exist, is a directory, or isn't valid UTF-8. Callers print
 * `error` to stderr and exit(1) — this function never exits.
 */
export function readSourceFile(path) {
  if (!fs.existsSync(path)) {
    return { text: null, error: `エラー: ファイルが見つかりません: ${path}` };
  }
  const stat = fs.statSync(path);
  if (stat.isDirectory()) {
    return { text: null, error: `エラー: ディレクトリが指定されました（ファイルを指定してください）: ${path}` };
  }
  try {
    const buf = fs.readFileSync(path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { text, error: null };
  } catch (exc) {
    return { text: null, error: `エラー: ファイルを読み込めません: ${path} (${exc.message})` };
  }
}

// ---------------------------------------------------------------------------
// HTML extraction (for .html input)
// ---------------------------------------------------------------------------

const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (m, ent) => {
    if (ent[0] === "#") {
      const codePoint = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : m;
    }
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, ent) ? HTML_ENTITIES[ent] : m;
  });
}

// Elements whose entire subtree must not be linted: they hold source code,
// tabular IR data, or (for .wu-figure) a rendered diagram + its embedded IR
// <script>, none of which is prose.
const MASKED_WHOLE_TAGS = ["script", "style", "pre", "code", "table"];

function stripMaskedTags(html) {
  let out = html;
  for (const tag of MASKED_WHOLE_TAGS) {
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, "\n");
  }
  return out;
}

function stripWuFigure(html) {
  // .wu-figure wraps a rendered SVG diagram plus its IR <script>; neither is
  // prose. Handles any element name (figure/div/section) carrying the class.
  const re = /<([a-zA-Z0-9]+)([^>]*\bclass\s*=\s*"[^"]*\bwu-figure\b[^"]*"[^>]*)>[\s\S]*?<\/\1>/gi;
  return html.replace(re, "\n");
}

const BLOCK_END_TAGS = /<\/(p|h1|h2|h3|h4|h5|h6|li|blockquote|dt|dd|tr|figcaption|div|section|article)>/gi;
const BLOCK_BREAKS = /<(br|hr)\s*\/?>/gi;

/**
 * Extracts prose text from an HTML page, masking `pre`, `code`, `table`,
 * `script`, `style`, and any element carrying the `.wu-figure` class
 * (rendered diagram + its embedded IR YAML) before stripping tags, so the
 * lint gate never analyzes code samples, table cell data, or diagram IR as
 * prose. Paragraph boundaries (blank line between block-level elements) are
 * preserved so sentence/paragraph-based detectors still see document
 * structure. The returned text has its own coordinate system (offsets are
 * not mapped back to the source HTML).
 */
export function extractTextFromHtml(html) {
  let text = stripMaskedTags(html);
  text = stripWuFigure(text);
  text = text.replace(BLOCK_END_TAGS, "\n\n");
  text = text.replace(BLOCK_BREAKS, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  // Collapse runs of 3+ blank lines to exactly one blank line (paragraph
  // boundary) without touching intra-sentence whitespace.
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n");
  return text.trim() + "\n";
}
