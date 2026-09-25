// tokenize.mjs — the ONLY place in writeup-kit that touches the morphological
// analyzer. Every detector that needs part-of-speech, base form, or reading
// goes through the functions exported here, so swapping the analyzer (e.g.
// lindera/IPADIC -> a UniDic-backed one) later only touches this file.
//
// Backend: lindera (WASM build), embedded IPADIC dictionary, vendored under
// vendor/lindera/. IPADIC segments shorter than Sudachi's SplitMode C
// ("longest unit") used by the original Python lint (natural-japanese
// scripts/lint.py). The detectors read the raw IPADIC stream: a 25-text
// calibration corpus (test/fixtures/lint-corpus/) showed the raw tokens
// track the original's ngram / low_specificity / lexical_diversity values
// more closely than the compound-noun join did (the join over-merges
// relative to SplitMode C). `joinNouns: true` — joinNounTokens() below —
// stays available as an opt-in for callers that want longest-unit nouns.

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_LINDERA_JS = path.join(__dirname, "..", "..", "vendor", "lindera", "lindera_wasm.js");

let tokenizerPromise = null;

/**
 * Lazily builds (and caches) the lindera Tokenizer singleton. Building the
 * WASM tokenizer costs ~100-200ms (dictionary decompression); every caller
 * in the same process shares this one instance.
 */
async function getRawTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      const { TokenizerBuilder } = await import(VENDOR_LINDERA_JS);
      const builder = new TokenizerBuilder();
      builder.setDictionary("embedded://ipadic");
      builder.setMode("normal");
      return builder.build();
    })();
  }
  return tokenizerPromise;
}

/**
 * `detail` array order for the IPADIC schema (see vendor/lindera README):
 * [pos1, pos2, pos3, pos4, conjType, conjForm, baseForm, reading, pronunciation]
 */
function detailAt(details, index, fallback) {
  const v = details && details[index];
  if (v === undefined || v === null || v === "*" || v === "") return fallback;
  return v;
}

/**
 * Tokenizes `text` and returns a flat array of
 * `{ surface, pos: [pos1, pos2], baseForm, reading, begin, end }`.
 *
 * `begin`/`end` are character offsets into `text` (NOT the byte offsets the
 * wasm binding reports on `Token.byte_start`/`byte_end` — those are UTF-8
 * byte positions and would be wrong for any non-ASCII text once used as
 * JS string indices). We recover them by scanning forward through `text`
 * for each token's surface form in order.
 *
 * `joinNouns`: when true, runs joinNounTokens() over the raw token stream
 * before returning — see that function's doc comment.
 */
export async function tokenize(text, { joinNouns = false } = {}) {
  if (!text) return [];
  const tokenizer = await getRawTokenizer();
  const rawTokens = tokenizer.tokenize(text);

  const tokens = [];
  let cursor = 0;
  for (const t of rawTokens) {
    const surface = t.surface;
    let begin = text.indexOf(surface, cursor);
    if (begin === -1) {
      // Should not normally happen (lindera's keep-whitespace=false default
      // can drop whitespace tokens the tokenizer itself doesn't emit as
      // surfaces we can find verbatim); fall back to a zero-width token at
      // the cursor so downstream span math never goes negative or out of
      // order.
      begin = cursor;
    }
    const end = begin + surface.length;
    const details = t.details || [];
    tokens.push({
      surface,
      pos: [detailAt(details, 0, "*"), detailAt(details, 1, "*")],
      baseForm: detailAt(details, 6, surface),
      reading: detailAt(details, 7, surface),
      begin,
      end,
    });
    cursor = end;
  }

  return joinNouns ? joinNounTokens(tokens) : tokens;
}

const NUMERIC_NOUN_POS2 = "数";

/**
 * Compound-noun join: merges consecutive 名詞 (noun) tokens into a single
 * token, EXCLUDING 名詞,数 (numbers, which the original Sudachi-based lint
 * kept separate for the numeric-quantity regex to match) and any non-名詞
 * (e.g. 記号) token, which simply breaks the run.
 *
 * This exists because the Python original tokenized with Sudachi
 * SplitMode.C ("longest unit"), so a term like 医薬品安全管理責任者 came
 * back as ONE morpheme. IPADIC (this port's backend) always segments at
 * its shortest dictionary units, so the same term is 5 tokens
 * (医薬品/安全/管理/責任/者). Detectors that count/compare whole nouns
 * (ngram_repetition's proper-noun lead check, low_specificity's proper-noun
 * density, lexical_diversity's content-word TTR) need the coarser
 * granularity to behave like the original; detectors matching short fixed
 * tokens (これ/それ/こと/でき...) do not, so joinNouns is opt-in per
 * detector, not global.
 */
export function joinNounTokens(tokens) {
  const out = [];
  let buffer = [];

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      out.push(buffer[0]);
    } else {
      out.push({
        surface: buffer.map((t) => t.surface).join(""),
        pos: ["名詞", "複合"],
        baseForm: buffer.map((t) => t.baseForm).join(""),
        reading: buffer.map((t) => t.reading).join(""),
        begin: buffer[0].begin,
        end: buffer[buffer.length - 1].end,
      });
    }
    buffer = [];
  };

  for (const t of tokens) {
    const isJoinableNoun = t.pos[0] === "名詞" && t.pos[1] !== NUMERIC_NOUN_POS2;
    if (isJoinableNoun) {
      buffer.push(t);
    } else {
      flush();
      out.push(t);
    }
  }
  flush();

  return out;
}
