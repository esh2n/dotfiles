// lint-calibration.test.mjs — runs the calibration corpus
// (test/fixtures/lint-corpus, see its README) through the lint and pins the
// good/bad separation the 2026-08 recalibration of bin/lib/lint/morph.mjs
// was measured on. If a threshold or the token stream changes, these tests
// say which control moved.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runLint } from "../bin/lib/lint/index.mjs";
import { BURSTINESS_THRESHOLD, NGRAM_TEMPLATE_RATIO_THRESHOLD, TTR_THRESHOLD, MTLD_THRESHOLD } from "../bin/lib/lint/morph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(__dirname, "fixtures", "lint-corpus");

// The 12 categories produced by the tokenizer-backed detectors in morph.mjs.
const MORPH_CATEGORIES = new Set([
  "nominal_ending",
  "paragraph_lead_conjunction",
  "uniform_paragraph_structure",
  "translationese_morph",
  "inanimate_subject_morph",
  "low_burstiness",
  "high_length_autocorrelation",
  "repeated_sentence_lead",
  "repeated_syntax_template",
  "low_lexical_diversity_ttr",
  "low_lexical_diversity_mtld",
  "low_specificity",
]);

const corpusFiles = fs.readdirSync(CORPUS).filter((n) => n.endsWith(".txt")).sort();
const results = new Map(); // file -> { default: {findings, stats}, experimental: {findings, stats} }

before(async () => {
  for (const f of corpusFiles) {
    const text = fs.readFileSync(path.join(CORPUS, f), "utf-8");
    results.set(f, {
      default: await runLint(text),
      experimental: await runLint(text, { experimental: true }),
    });
  }
});

function categories(file, mode = "default") {
  const counts = {};
  for (const x of results.get(file)[mode].findings) counts[x.category] = (counts[x.category] || 0) + 1;
  return counts;
}

function morphCategories(file, mode = "default") {
  return Object.keys(categories(file, mode)).filter((c) => MORPH_CATEGORIES.has(c)).sort();
}

describe("corpus layout", () => {
  test("has 15 store-derived texts and 10 controls, all listed in README.md", () => {
    const store = corpusFiles.filter((n) => n.startsWith("store-"));
    const ctrl = corpusFiles.filter((n) => n.startsWith("ctrl-"));
    assert.equal(store.length, 15);
    assert.equal(ctrl.length, 10);
    const readme = fs.readFileSync(path.join(CORPUS, "README.md"), "utf-8");
    for (const f of corpusFiles) assert.ok(readme.includes(f), `${f} is not described in README.md`);
  });
});

describe("good controls pass", () => {
  for (const f of ["ctrl-good-01-minutes.txt", "ctrl-good-02-essay.txt", "ctrl-good-03-techmemo.txt", "ctrl-good-05-decision.txt"]) {
    test(`${f}: no findings at all (default options)`, () => {
      assert.deepEqual(categories(f), {});
    });
  }

  test("ctrl-good-04-long-report.txt: only low_lexical_diversity_ttr, which is documented as non-separating", () => {
    // TTR at the original's 0.45 fires on every corpus doc past the
    // 4,000-char gate, this well-written report included (kit 0.374, the
    // Python original 0.383). It was left at 0.45 on purpose so the two
    // implementations keep agreeing; MTLD is the length-normalized measure
    // and does separate (this doc 121, the bad control 12).
    assert.deepEqual(Object.keys(categories("ctrl-good-04-long-report.txt")), ["low_lexical_diversity_ttr"]);
    const lexdiv = results.get("ctrl-good-04-long-report.txt").default.stats.lexicalDiversity;
    assert.ok(lexdiv.docCharCount >= 4000, `report must pass the lexdiv gate (got ${lexdiv.docCharCount} chars)`);
    assert.ok(lexdiv.mtld > MTLD_THRESHOLD);
  });

  test("no good control fires low_burstiness, and every one is above the threshold with margin", () => {
    for (const f of corpusFiles.filter((n) => n.startsWith("ctrl-good-"))) {
      const b = results.get(f).default.stats.rhythm.burstiness;
      assert.ok(b > BURSTINESS_THRESHOLD, `${f}: burstiness ${b.toFixed(3)} <= ${BURSTINESS_THRESHOLD}`);
    }
  });

  test("EXPERIMENTAL repeated_syntax_template does not fire on the minutes control (ratio 0.417 vs threshold 0.45)", () => {
    const stats = results.get("ctrl-good-01-minutes.txt").experimental.stats;
    assert.ok(stats.ngram.leadPos4gramRatio < NGRAM_TEMPLATE_RATIO_THRESHOLD);
    assert.ok(!("repeated_syntax_template" in categories("ctrl-good-01-minutes.txt", "experimental")));
  });
});

describe("bad controls fire the intended detector", () => {
  test("ctrl-bad-01-lead-repeat.txt: repeated_sentence_lead on every sentence, plus the template detector under --experimental", () => {
    const c = categories("ctrl-bad-01-lead-repeat.txt");
    assert.equal(c.repeated_sentence_lead, 11);
    assert.ok(c.low_burstiness >= 1);
    assert.equal(categories("ctrl-bad-01-lead-repeat.txt", "experimental").repeated_syntax_template, 11);
  });

  test("ctrl-bad-02-low-lexdiv.txt: both TTR and MTLD fire, and nominal_ending (0 体言止め in 4,000+ chars)", () => {
    const c = categories("ctrl-bad-02-low-lexdiv.txt");
    assert.equal(c.low_lexical_diversity_ttr, 1);
    assert.equal(c.low_lexical_diversity_mtld, 1);
    assert.equal(c.nominal_ending, 1);
    const lexdiv = results.get("ctrl-bad-02-low-lexdiv.txt").default.stats.lexicalDiversity;
    assert.ok(lexdiv.ttr < TTR_THRESHOLD);
    assert.ok(lexdiv.mtld < MTLD_THRESHOLD);
  });

  test("ctrl-bad-03-low-specificity.txt: all three paragraphs fire low_specificity", () => {
    assert.equal(categories("ctrl-bad-03-low-specificity.txt").low_specificity, 3);
    assert.deepEqual(results.get("ctrl-bad-03-low-specificity.txt").default.stats.lowSpecificity, { paragraphsEvaluated: 3, paragraphsFired: 3 });
  });

  test("ctrl-bad-04-uniform-rhythm.txt: low_burstiness", () => {
    assert.equal(categories("ctrl-bad-04-uniform-rhythm.txt").low_burstiness, 1);
  });

  test("ctrl-bad-05-ai-flavored.txt: forbidden_phrase + translationese_morph, and the paragraph-shape detectors under --experimental", () => {
    const c = categories("ctrl-bad-05-ai-flavored.txt");
    assert.ok(c.forbidden_phrase >= 3);
    assert.ok(c.translationese_morph >= 5);
    const e = categories("ctrl-bad-05-ai-flavored.txt", "experimental");
    assert.equal(e.uniform_paragraph_structure, 1);
    assert.ok(e.paragraph_lead_conjunction >= 2);
  });

  test("every bad control is below the burstiness threshold", () => {
    for (const f of corpusFiles.filter((n) => n.startsWith("ctrl-bad-"))) {
      const b = results.get(f).default.stats.rhythm.burstiness;
      assert.ok(b < BURSTINESS_THRESHOLD, `${f}: burstiness ${b.toFixed(3)} >= ${BURSTINESS_THRESHOLD}`);
    }
  });
});

describe("store pages: agreement with the Python original (Sudachi C) is pinned", () => {
  // Values below are the Python original's output on the same files
  // (uv run scripts/lint.py --json --experimental), recorded 2026-08-28.
  test("repeated_sentence_lead counts match the original exactly where the unjoined stream was verified", () => {
    const expected = { "store-04-locking.txt": 17, "store-07-ddd-trilemma.txt": 8, "store-09-hash-mac.txt": 6, "store-10-postmortem.txt": 9, "store-11-design-decisions.txt": 12 };
    for (const [f, n] of Object.entries(expected)) {
      assert.equal(categories(f).repeated_sentence_lead ?? 0, n, `${f}: repeated_sentence_lead`);
    }
  });

  test("TTR fires on all 8 pages past the 4,000-char gate (as in the original) and MTLD on none", () => {
    const gated = corpusFiles.filter((f) => f.startsWith("store-") && results.get(f).default.stats.lexicalDiversity.ttr !== null);
    assert.equal(gated.length, 8);
    for (const f of gated) {
      const c = categories(f);
      assert.equal(c.low_lexical_diversity_ttr, 1, `${f}: TTR should fire`);
      assert.ok(!c.low_lexical_diversity_mtld, `${f}: MTLD should not fire`);
    }
  });

  test("no store page fires low_burstiness (kit -0.309 .. +0.011 measured)", () => {
    for (const f of corpusFiles.filter((n) => n.startsWith("store-"))) {
      assert.ok(!categories(f).low_burstiness, `${f} fired low_burstiness`);
    }
  });

  test("low_specificity fires on at most one paragraph per store page (original: store-08 = 2, all others 0)", () => {
    for (const f of corpusFiles.filter((n) => n.startsWith("store-"))) {
      const fired = results.get(f).default.stats.lowSpecificity.paragraphsFired;
      assert.ok(fired <= (f === "store-08-virtual-dom.txt" ? 2 : 0), `${f}: low_specificity fired ${fired}`);
    }
  });

  test("only morph categories that the original also reports appear on store pages", () => {
    for (const f of corpusFiles.filter((n) => n.startsWith("store-"))) {
      for (const c of morphCategories(f)) {
        assert.ok(["repeated_sentence_lead", "low_lexical_diversity_ttr", "low_specificity", "translationese_morph"].includes(c), `${f}: unexpected morph category ${c}`);
      }
    }
  });
});
