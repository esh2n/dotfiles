import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { runLint, computeBaselineDiff, validateBaselineData, EXPERIMENTAL_CATEGORIES } from "../bin/lib/lint/index.mjs";
import { parseToml, TomlParseError } from "../bin/lib/toml-lite.mjs";
import { loadWriteupConfig, isAllowed, discoverConfigPath } from "../bin/lib/lint/config.mjs";
import { extractTextFromHtml } from "../bin/lib/text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "lint");
const LINT_BIN = path.join(__dirname, "..", "bin", "lint.mjs");

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

function categoriesOf(findings) {
  return new Set(findings.map((f) => f.category));
}

/** Runs the real CLI as a subprocess; returns { code, stdout, stderr }. Never
 * throws on a non-zero exit (execFileSync would) — tests assert on `code`. */
function runCli(args) {
  try {
    const stdout = execFileSync("node", [LINT_BIN, ...args], { encoding: "utf-8" });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? "" };
  }
}

// ---------------------------------------------------------------------------
// Surface detectors (6) — the --surface-only gate scope
// ---------------------------------------------------------------------------

describe("forbidden_phrase", () => {
  test("positive: fires on a listed cliché phrase", async () => {
    const { findings } = await runLint("重要なのは、この結果です。\n");
    assert.ok(categoriesOf(findings).has("forbidden_phrase"));
  });

  test("negative: a clean sentence has no forbidden_phrase finding", async () => {
    const { findings } = await runLint(fixture("clean-natural.txt"));
    assert.ok(!categoriesOf(findings).has("forbidden_phrase"));
  });

  // Summary signal phrases (writing.md "Prohibitions"): a phrase that only
  // announces a summary is starting. 結論から言うと / まとめると were already
  // listed; 以下に示す / 本節では join them at the same warn severity.
  for (const phrase of ["結論から言うと", "まとめると", "以下に示す", "本節では"]) {
    test(`positive: summary signal phrase 「${phrase}」 fires at warn`, async () => {
      const { findings } = await runLint(`${phrase}、再試行は 3 回で止める。\n`);
      const hit = findings.find((f) => f.category === "forbidden_phrase" && f.message.includes(phrase));
      assert.ok(hit, JSON.stringify(findings));
      assert.equal(hit.severity, "warn");
    });
  }

  test("negative: the summary itself, without a signal phrase, is clean", async () => {
    const { findings } = await runLint("再試行は 3 回で止める。上限に達した処理は退避する。\n");
    assert.ok(!categoriesOf(findings).has("forbidden_phrase"));
  });

  test("a signal phrase can still be kept through the [[allow]] mechanism", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-lint-signal-"));
    try {
      const cfg = path.join(dir, "allow.toml");
      fs.writeFileSync(cfg, ["[[allow]]", 'category = "forbidden_phrase"', 'text = "本節では"', 'reason = "quoted heading"'].join("\n"));
      const target = path.join(dir, "doc.txt");
      fs.writeFileSync(target, "本節では、再試行を扱う。\n");
      const { code, stdout } = runCli([target, "--config", cfg, "--json"]);
      assert.equal(code, 0);
      assert.ok(!JSON.parse(stdout).findings.some((f) => f.category === "forbidden_phrase"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("translationese (surface)", () => {
  test("positive: 'することができる' pattern fires", async () => {
    const { findings } = await runLint("この機能は簡単に利用することができる。\n");
    assert.ok(categoriesOf(findings).has("translationese"));
  });

  test("negative: a plain declarative sentence does not fire", async () => {
    const { findings } = await runLint(fixture("clean-natural.txt"));
    assert.ok(!categoriesOf(findings).has("translationese"));
  });
});

describe("antithesis_repetition", () => {
  test("positive: 3+ 'ではなく' hits in a short document fire (and rank severity by density)", async () => {
    const { findings } = await runLint(fixture("antithesis-repetition.txt"));
    const hits = findings.filter((f) => f.category === "antithesis_repetition");
    assert.ok(hits.length >= 3);
    assert.ok(["info", "warn", "critical"].includes(hits[0].severity));
  });

  test("negative: no antithesis pattern in clean text", async () => {
    const { findings } = await runLint(fixture("clean-natural.txt"));
    assert.ok(!categoriesOf(findings).has("antithesis_repetition"));
  });
});

describe("low_sentence_variance", () => {
  test("positive: near-identical sentence lengths fire", async () => {
    const { findings } = await runLint(fixture("rhythm-uniform.txt"));
    assert.ok(categoriesOf(findings).has("low_sentence_variance"));
  });

  test("negative: widely varying sentence lengths do not fire", async () => {
    const text = "短い。\n" + "これはそこそこの長さの文でそれなりの情報量を含んでいる。\n" + "これは非常に長い文であり、多くの情報を詰め込んで意図的に長く書かれた一文になっている、という具合である。\n" + "また短い。\n" + "普通の長さの文がここに一つある。\n" + "これも同様に普通程度の長さを持つ文である。\n";
    const { findings } = await runLint(text);
    assert.ok(!categoriesOf(findings).has("low_sentence_variance"));
  });
});

describe("english_syntax_smell (surface: inanimate subject + cleft-because)", () => {
  test("positive: これは...もたらす fires english_syntax_inanimate_subject", async () => {
    const { findings } = await runLint("これは大きな変化をもたらす。\n");
    assert.ok(categoriesOf(findings).has("english_syntax_inanimate_subject"));
  });

  test("negative: a normal sentence does not fire", async () => {
    const { findings } = await runLint(fixture("clean-natural.txt"));
    assert.ok(!categoriesOf(findings).has("english_syntax_inanimate_subject"));
  });

  test("cleft-because (EXPERIMENTAL) only appears with --experimental", async () => {
    const text = "それは重要である。なぜなら多くの人が関わっているからだ。\n";
    const withoutExp = await runLint(text);
    const withExp = await runLint(text, { experimental: true });
    assert.ok(!categoriesOf(withoutExp.findings).has("english_syntax_cleft_because"));
    assert.ok(categoriesOf(withExp.findings).has("english_syntax_cleft_because"));
  });
});

describe("structural_ai_habits (Markdown-level, EXPERIMENTAL)", () => {
  test("positive: heavy bold usage fires high_bold_density under --experimental", async () => {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push(`- **項目${i}** の説明文がここに入る。`);
    const text = lines.join("\n") + "\n";
    const { findings } = await runLint(text, { experimental: true });
    assert.ok(categoriesOf(findings).has("high_bold_density"));
  });

  test("negative: plain prose does not fire", async () => {
    const { findings } = await runLint(fixture("clean-natural.txt"), { experimental: true });
    assert.ok(!categoriesOf(findings).has("high_bold_density"));
  });
});

describe("long_sentence (NEW, contract §5)", () => {
  test("warn at >80 chars, error at >120 chars, no finding under 80", async () => {
    const { findings } = await runLint(fixture("long-sentence.txt"));
    const hits = findings.filter((f) => f.category === "long_sentence");
    assert.equal(hits.length, 2);
    assert.equal(hits.find((f) => f.span.line === 2).severity, "warn");
    assert.equal(hits.find((f) => f.span.line === 3).severity, "error");
  });

  test("negative: short sentences never fire long_sentence", async () => {
    const { findings } = await runLint(fixture("clean-natural.txt"));
    assert.ok(!categoriesOf(findings).has("long_sentence"));
  });
});

describe("nested_parentheses (NEW, contract §5)", () => {
  test("positive: 2+ parenthetical annotations in one sentence fire", async () => {
    const { findings } = await runLint(fixture("nested-parens.txt"));
    const hits = findings.filter((f) => f.category === "nested_parentheses");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "warn");
  });

  test("negative: a single parenthetical (or none) does not fire", async () => {
    const { findings } = await runLint("この方式（新方式）を採用した。\n普通の文にはかっこがない。\n");
    assert.ok(!categoriesOf(findings).has("nested_parentheses"));
  });

  test("counts full-width and half-width parentheses alike", async () => {
    const { findings } = await runLint("この件(理由1)は前回(理由2)とは違う。\n");
    assert.ok(categoriesOf(findings).has("nested_parentheses"));
  });
});

// ---------------------------------------------------------------------------
// Morph (tokenizer-backed) detectors (7)
// ---------------------------------------------------------------------------

describe("nominal_ending (absence-of-nominal-ending detector)", () => {
  test("positive: a long document with zero nominal endings fires", async () => {
    const { findings } = await runLint(fixture("nominal-ending-absent.txt"));
    assert.ok(categoriesOf(findings).has("nominal_ending"));
  });

  test("negative: a short document (below the 2000-char gate) never fires", async () => {
    const { findings } = await runLint("これは動く。それも動く。あれも動く。それらも動く。ここも動く。\n");
    assert.ok(!categoriesOf(findings).has("nominal_ending"));
  });
});

describe("paragraph_lead_conjunction (EXPERIMENTAL)", () => {
  test("positive: most paragraphs opening with a listed conjunction fire under --experimental", async () => {
    const paras = ["最初の段落はここから始まる文章である。", "しかし、ここでは違う話をする。", "また、別の観点から考える。", "そのため、結論はこうなる。"];
    const text = paras.join("\n\n") + "\n";
    const { findings } = await runLint(text, { experimental: true });
    assert.ok(categoriesOf(findings).has("paragraph_lead_conjunction"));
  });
});

describe("uniform_paragraph_structure (EXPERIMENTAL)", () => {
  test("positive: every paragraph has exactly 3 sentences", async () => {
    const { findings } = await runLint(fixture("uniform-paragraphs.txt"), { experimental: true });
    assert.ok(categoriesOf(findings).has("uniform_paragraph_structure"));
  });

  test("negative: paragraph sentence counts vary widely", async () => {
    const paras = ["一文だけの段落。", "これは二文の段落。もう一文ある。", "一文目。二文目。三文目。四文目。五文目。", "また一文だけ。"];
    const text = paras.join("\n\n") + "\n";
    const { findings } = await runLint(text, { experimental: true });
    assert.ok(!categoriesOf(findings).has("uniform_paragraph_structure"));
  });
});

describe("translationese_morph (POS-sequence: こと+が/は+でき...)", () => {
  test("positive fires regardless of okurigana/conjugation variant", async () => {
    const { findings } = await runLint("実装することができる。\n");
    assert.ok(categoriesOf(findings).has("translationese_morph"));
  });

  test("negative: 'こと' not followed by が/は+でき does not fire", async () => {
    const { findings } = await runLint("大事なことを話した。\n");
    assert.ok(!categoriesOf(findings).has("translationese_morph"));
  });
});

describe("inanimate_subject_morph (POS-sequence version)", () => {
  test("positive: abstract subject + transitive-smell verb fires", async () => {
    const { findings } = await runLint("これは大きな変化を示す。\n");
    assert.ok(categoriesOf(findings).has("inanimate_subject_morph"));
  });

  test("negative: a human subject does not fire", async () => {
    const { findings } = await runLint("担当者がこの変化を示した資料を作った。\n");
    assert.ok(!categoriesOf(findings).has("inanimate_subject_morph"));
  });
});

describe("rhythm_statistics (mora-based burstiness)", () => {
  test("positive: near-uniform mora lengths across >=6 sentences fire low_burstiness", async () => {
    const { findings } = await runLint(fixture("rhythm-uniform.txt"));
    assert.ok(categoriesOf(findings).has("low_burstiness"));
  });

  test("negative: fewer than 6 tokenized sentences never evaluates burstiness", async () => {
    const { findings, stats } = await runLint("猫が窓辺で眠っている。\n犬が庭を走っている。\n");
    assert.ok(!categoriesOf(findings).has("low_burstiness"));
    assert.deepEqual(stats.rhythm, {});
  });
});

describe("ngram_repetition (unjoined IPADIC tokens — see morph.mjs granularity note)", () => {
  test("positive: 6+ sentences sharing the same lead bigram fire repeated_sentence_lead", async () => {
    const { findings } = await runLint(fixture("ngram-repetition.txt"));
    assert.ok(categoriesOf(findings).has("repeated_sentence_lead"));
  });

  test("negative: varied sentence leads do not fire", async () => {
    const { findings } = await runLint(fixture("clean-natural.txt"));
    assert.ok(!categoriesOf(findings).has("repeated_sentence_lead"));
  });
});

describe("lexical_diversity (TTR / MTLD, unjoined IPADIC tokens)", () => {
  test("positive: a long, heavily repetitive document fires both TTR and MTLD", async () => {
    const { findings, stats } = await runLint(fixture("low-lexical-diversity.txt"));
    assert.ok(categoriesOf(findings).has("low_lexical_diversity_ttr"));
    assert.ok(categoriesOf(findings).has("low_lexical_diversity_mtld"));
    assert.ok(stats.lexicalDiversity.ttr < 0.45);
  });

  test("negative: a short document is skipped (below the 4000-char gate), not scored", async () => {
    const { findings, stats } = await runLint(fixture("clean-natural.txt"));
    assert.ok(!categoriesOf(findings).has("low_lexical_diversity_ttr"));
    assert.equal(stats.lexicalDiversity.skippedTooShort, true);
  });
});

describe("low_specificity (unjoined IPADIC tokens)", () => {
  test("positive: an abstract-noun-heavy paragraph with no proper nouns/numbers/examples fires", async () => {
    const { findings } = await runLint(fixture("low-specificity.txt"));
    assert.ok(categoriesOf(findings).has("low_specificity"));
  });

  test("negative: a paragraph with proper nouns, numbers, and an example marker does not fire", async () => {
    const text = "たとえば、東京都渋谷区にある新宿支店では2024年に3つの新しい取り組みを始めた。実際に田中さんが担当し、5件の改善提案を実施した。\n";
    const { findings } = await runLint(text);
    assert.ok(!categoriesOf(findings).has("low_specificity"));
  });
});

// ---------------------------------------------------------------------------
// EXPERIMENTAL gating, surface-only mode, genre profiles
// ---------------------------------------------------------------------------

describe("EXPERIMENTAL gating", () => {
  test("EXPERIMENTAL_CATEGORIES are excluded by default and included with experimental:true", async () => {
    const text = fixture("uniform-paragraphs.txt");
    const { findings: withoutExp } = await runLint(text);
    const { findings: withExp } = await runLint(text, { experimental: true });
    for (const f of withoutExp) assert.ok(!EXPERIMENTAL_CATEGORIES.has(f.category));
    assert.ok([...categoriesOf(withExp)].some((c) => EXPERIMENTAL_CATEGORIES.has(c)));
  });
});

describe("surfaceOnly mode (作業メモ gate scope)", () => {
  test("skips all 7 morph detectors even when their trigger text is present", async () => {
    const text = "実装することができる。これは大きな変化を示す。\n";
    const full = await runLint(text);
    const surface = await runLint(text, { surfaceOnly: true });
    assert.ok(categoriesOf(full.findings).has("translationese_morph"));
    assert.ok(categoriesOf(full.findings).has("inanimate_subject_morph"));
    assert.ok(!categoriesOf(surface.findings).has("translationese_morph"));
    assert.ok(!categoriesOf(surface.findings).has("inanimate_subject_morph"));
  });

  test("still runs the surface detectors plus long_sentence/nested_parentheses", async () => {
    const text = fixture("long-sentence.txt");
    const { findings } = await runLint(text, { surfaceOnly: true });
    assert.ok(categoriesOf(findings).has("long_sentence"));
  });
});

describe("genre profiles", () => {
  test("business genre disables the Markdown-structure EXPERIMENTAL categories", async () => {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push(`- **項目${i}** の説明文がここに入る。`);
    const text = lines.join("\n") + "\n";
    const { findings } = await runLint(text, { experimental: true, genre: "business" });
    assert.ok(!categoriesOf(findings).has("high_bold_density"));
  });
});

// ---------------------------------------------------------------------------
// Finding JSON shape
// ---------------------------------------------------------------------------

describe("finding shape", () => {
  test("every finding carries category / severity / excerpt / span / message / suggestion", async () => {
    const { findings } = await runLint("重要なのは、実装することができる点だ。\n");
    assert.ok(findings.length > 0);
    for (const f of findings) {
      assert.equal(typeof f.category, "string");
      assert.ok(["info", "warn", "error", "critical"].includes(f.severity));
      assert.equal(typeof f.excerpt, "string");
      assert.equal(typeof f.span.line, "number");
      assert.equal(typeof f.span.start, "number");
      assert.equal(typeof f.span.end, "number");
      assert.equal(typeof f.message, "string");
      assert.ok(f.suggestion === null || typeof f.suggestion === "string");
    }
  });
});

// ---------------------------------------------------------------------------
// --baseline diffing
// ---------------------------------------------------------------------------

describe("baseline diffing", () => {
  test("classifies findings as resolved / new / persisting", () => {
    const baseline = {
      findings: [
        { category: "forbidden_phrase", excerpt: "重要なのは、これが理由だ" },
        { category: "translationese", excerpt: "することができるという" },
      ],
    };
    const current = [
      { category: "forbidden_phrase", excerpt: "重要なのは、これが理由だ" }, // persists
      { category: "forbidden_phrase", excerpt: "まったく新しい指摘です" }, // new
    ];
    const { resolved, summary } = computeBaselineDiff(current, baseline);
    assert.equal(summary.persisting, 1);
    assert.equal(summary.new, 1);
    assert.equal(summary.resolved, 1);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].category, "translationese");
    assert.equal(current[0].status, "persisting");
    assert.equal(current[1].status, "new");
  });

  test("category-only-key categories ignore excerpt drift", () => {
    const baseline = { findings: [{ category: "low_burstiness", excerpt: "burstiness=-0.500 (old stats)" }] };
    const current = [{ category: "low_burstiness", excerpt: "burstiness=-0.512 (new stats)" }];
    const { summary } = computeBaselineDiff(current, baseline);
    assert.equal(summary.persisting, 1);
    assert.equal(summary.new, 0);
  });

  test("validateBaselineData falls back gracefully on a malformed payload", () => {
    const { data, warnings } = validateBaselineData({ notFindings: true });
    assert.equal(data, null);
    assert.ok(warnings.length > 0);
  });

  test("validateBaselineData skips non-dict entries but keeps valid ones", () => {
    const { data, warnings } = validateBaselineData({ findings: [{ category: "a", excerpt: "b" }, "garbage", 42] });
    assert.equal(data.findings.length, 1);
    assert.ok(warnings.length > 0);
  });
});

// ---------------------------------------------------------------------------
// HTML masking
// ---------------------------------------------------------------------------

describe("HTML extraction/masking", () => {
  test("component labels (<p><strong>決定:</strong> …) are dropped so repeated card labels are not prose", () => {
    const card = '<div class="wu-decision"><p><strong>決定:</strong> 判断は画面から直接書く。</p><p><strong>重視したトレードオフ:</strong> 速さより整合を優先した。</p><p><strong>根拠・補足:</strong></p><ul><li>出典 A</li></ul></div>';
    const text = extractTextFromHtml(card.repeat(3));
    assert.ok(!text.includes("決定:"));
    assert.ok(!text.includes("重視したトレードオフ:"));
    assert.ok(!text.includes("根拠・補足:"));
    assert.ok(text.includes("判断は画面から直接書く。"));
    // a strong span that is not a label prefix stays
    assert.ok(extractTextFromHtml("<p>これは<strong>重要:</strong>な点。</p>").includes("重要:"));
  });

  test("pre/code/table/script/style/.wu-figure content is excluded from lint text", () => {
    const html = fixture("masked.html");
    const text = extractTextFromHtml(html);
    assert.ok(!text.includes("style ブロック"));
    assert.ok(!text.includes("script の中身"));
    assert.ok(!text.includes("pre/code の中身"));
    assert.ok(!text.includes("表のセル"));
    assert.ok(!text.includes("diagram の中身"));
    assert.ok(text.includes("地の文だけがlintされる"));
    assert.ok(text.includes("もう一段落"));
  });

  test("end-to-end via the CLI: only the visible paragraph produces a finding", () => {
    const { code, stdout } = runCli([path.join(FIXTURES, "masked.html"), "--json"]);
    assert.equal(code, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.findings.length, 1);
    assert.equal(out.findings[0].excerpt.includes("地の文"), true);
  });
});

// ---------------------------------------------------------------------------
// .writeup.toml — parser + config validation + CLI wiring
// ---------------------------------------------------------------------------

describe("toml-lite parser", () => {
  test("parses a [lint] table and an array of [[allow]] tables", () => {
    const parsed = parseToml(
      [
        "[lint]",
        'disabled_rules = ["forbidden_phrase", "translationese"]',
        'fail_on = "warn"',
        "",
        "[[allow]]",
        'category = "long_sentence"',
        'text = "この一文は意図的に長い"',
        'reason = "quoted verbatim from a source"',
        "",
        "[[allow]]",
        'category = "nested_parentheses"',
        "text = 'literal string'",
        'reason = "second entry"',
      ].join("\n")
    );
    assert.deepEqual(parsed.lint.disabled_rules, ["forbidden_phrase", "translationese"]);
    assert.equal(parsed.lint.fail_on, "warn");
    assert.equal(parsed.allow.length, 2);
    assert.equal(parsed.allow[1].text, "literal string");
  });

  test("supports booleans, integers, and comments", () => {
    const parsed = parseToml(["[lint]", "# a comment line", "strict = true  ", "max_findings = 42"].join("\n"));
    assert.equal(parsed.lint.strict, true);
    assert.equal(parsed.lint.max_findings, 42);
  });

  test("supports a multi-line array", () => {
    const parsed = parseToml(["[lint]", "disabled_rules = [", '  "a",', '  "b",', "]"].join("\n"));
    assert.deepEqual(parsed.lint.disabled_rules, ["a", "b"]);
  });

  test("throws TomlParseError on an inline table (unsupported)", () => {
    assert.throws(() => parseToml('[lint]\nx = { a = 1 }'), TomlParseError);
  });
});

describe("config validation", () => {
  function withTempConfig(contents, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-cfg-"));
    const file = path.join(dir, ".writeup.toml");
    fs.writeFileSync(file, contents, "utf-8");
    try {
      return fn(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a well-formed config loads with no errors", () => {
    withTempConfig(
      ['[lint]', 'disabled_rules = ["forbidden_phrase"]', "", "[[allow]]", 'category = "long_sentence"', 'text = "foo"', 'reason = "bar"'].join("\n"),
      (file) => {
        const { config, errors } = loadWriteupConfig(file);
        assert.equal(errors.length, 0);
        assert.deepEqual(config.disabledRules, ["forbidden_phrase"]);
        assert.equal(config.allowList.length, 1);
      }
    );
  });

  test("an [[allow]] entry missing 'reason' is a config error", () => {
    withTempConfig(["[[allow]]", 'category = "long_sentence"', 'text = "foo"'].join("\n"), (file) => {
      const { errors } = loadWriteupConfig(file);
      assert.ok(errors.length > 0);
      assert.ok(errors[0].includes("reason"));
    });
  });

  test("foreign top-level sections ([private], [cloudflare], and any other unknown name) are ignored silently", () => {
    withTempConfig(
      [
        "[lint]",
        'disabled_rules = ["forbidden_phrase"]',
        "",
        "[private]",
        'words = ["社内コードネーム"]',
        "",
        "[cloudflare]",
        'project = "example-project"',
        "access_required = true",
        "",
        "[typo]",
        'foo = "bar"',
      ].join("\n"),
      (file) => {
        const { config, errors } = loadWriteupConfig(file);
        assert.equal(errors.length, 0);
        assert.deepEqual(config.disabledRules, ["forbidden_phrase"]);
      }
    );
  });

  test("the shared store-config fixture ([lint] + [[allow]] + [private] + [cloudflare]) loads with no errors", () => {
    const { config, errors } = loadWriteupConfig(path.join(FIXTURES, "store-config.toml"));
    assert.equal(errors.length, 0);
    assert.deepEqual(config.disabledRules, ["translationese"]);
    assert.equal(config.allowList.length, 1);
    assert.equal(config.allowList[0].category, "forbidden_phrase");
  });

  test("an unknown key inside [lint] is a config error", () => {
    withTempConfig('[lint]\nnot_a_real_key = true', (file) => {
      const { errors } = loadWriteupConfig(file);
      assert.ok(errors.some((e) => e.includes("not_a_real_key")));
    });
  });

  test("a non-existent config path is treated as no config (no errors)", () => {
    const { config, errors } = loadWriteupConfig("/no/such/path/.writeup.toml");
    assert.equal(errors.length, 0);
    assert.deepEqual(config.disabledRules, []);
  });

  test("isAllowed() matches by category + excerpt substring", () => {
    const allowList = [{ category: "forbidden_phrase", text: "重要なのは", reason: "x" }];
    assert.equal(isAllowed({ category: "forbidden_phrase", excerpt: "重要なのは、これだ" }, allowList), true);
    assert.equal(isAllowed({ category: "translationese", excerpt: "重要なのは、これだ" }, allowList), false);
  });
});

describe("CLI wiring for config + allow/disabled_rules", () => {
  function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-cli-"));
    try {
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test("--config pointing at an allow-without-reason file exits 2", () => {
    withTempDir((dir) => {
      const cfg = path.join(dir, "bad.toml");
      fs.writeFileSync(cfg, ["[[allow]]", 'category = "forbidden_phrase"', 'text = "重要"'].join("\n"));
      const target = path.join(dir, "doc.txt");
      fs.writeFileSync(target, "重要なのは、これだ。\n");
      const { code, stderr } = runCli([target, "--config", cfg]);
      assert.equal(code, 2);
      assert.ok(stderr.includes("reason"));
    });
  });

  test("a valid allow entry with reason suppresses the matching finding", () => {
    withTempDir((dir) => {
      const cfg = path.join(dir, "good.toml");
      fs.writeFileSync(cfg, ["[[allow]]", 'category = "forbidden_phrase"', 'text = "重要なのは"', 'reason = "product name"'].join("\n"));
      const target = path.join(dir, "doc.txt");
      fs.writeFileSync(target, "重要なのは、これだ。\n");
      const { code, stdout } = runCli([target, "--config", cfg, "--json"]);
      assert.equal(code, 0);
      const out = JSON.parse(stdout);
      assert.ok(!out.findings.some((f) => f.category === "forbidden_phrase"));
    });
  });

  test("disabled_rules in [lint] drops the category entirely", () => {
    withTempDir((dir) => {
      const cfg = path.join(dir, "disable.toml");
      fs.writeFileSync(cfg, ["[lint]", 'disabled_rules = ["forbidden_phrase"]'].join("\n"));
      const target = path.join(dir, "doc.txt");
      fs.writeFileSync(target, "重要なのは、これだ。\n");
      const { stdout } = runCli([target, "--config", cfg, "--json"]);
      const out = JSON.parse(stdout);
      assert.ok(!out.findings.some((f) => f.category === "forbidden_phrase"));
    });
  });

  test("--config pointing at a non-existent file exits 1", () => {
    const target = path.join(FIXTURES, "clean-natural.txt");
    const { code, stderr } = runCli([target, "--config", "/no/such/config.toml"]);
    assert.equal(code, 1);
    assert.ok(stderr.length > 0);
  });

  test("--config pointing at the shared store-config fixture exits 0 and its [[allow]] suppresses the matching finding", () => {
    withTempDir((dir) => {
      const cfg = path.join(FIXTURES, "store-config.toml");
      const target = path.join(dir, "doc.txt");
      fs.writeFileSync(target, "重要なのは、これだ。\n");
      const { code, stdout } = runCli([target, "--config", cfg, "--json"]);
      assert.equal(code, 0);
      const out = JSON.parse(stdout);
      assert.ok(!out.findings.some((f) => f.category === "forbidden_phrase"));
    });
  });
});

// ---------------------------------------------------------------------------
// default config discovery (no --config)
// ---------------------------------------------------------------------------

describe("default config discovery", () => {
  test("discoverConfigPath finds .writeup.toml in an ancestor directory", () => {
    const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-disc-"));
    try {
      const cfg = path.join(outerDir, ".writeup.toml");
      fs.writeFileSync(cfg, '[lint]\nfail_on = "warn"\n');
      const innerDir = path.join(outerDir, "a", "b");
      fs.mkdirSync(innerDir, { recursive: true });
      assert.equal(discoverConfigPath(innerDir), cfg);
    } finally {
      fs.rmSync(outerDir, { recursive: true, force: true });
    }
  });

  test("discoverConfigPath falls back to $WRITEUP_STORE/.writeup.toml when no ancestor has one", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-store-"));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-target-"));
    const prevStore = process.env.WRITEUP_STORE;
    try {
      const cfg = path.join(storeDir, ".writeup.toml");
      fs.writeFileSync(cfg, '[lint]\nfail_on = "error"\n');
      process.env.WRITEUP_STORE = storeDir;
      assert.equal(discoverConfigPath(targetDir), cfg);
    } finally {
      if (prevStore === undefined) delete process.env.WRITEUP_STORE;
      else process.env.WRITEUP_STORE = prevStore;
      fs.rmSync(storeDir, { recursive: true, force: true });
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("discoverConfigPath returns null when nothing is found", () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-none-"));
    const prevStore = process.env.WRITEUP_STORE;
    try {
      delete process.env.WRITEUP_STORE;
      assert.equal(discoverConfigPath(targetDir), null);
    } finally {
      if (prevStore === undefined) delete process.env.WRITEUP_STORE;
      else process.env.WRITEUP_STORE = prevStore;
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("the CLI (no --config) picks up an ancestor .writeup.toml and applies its disabled_rules", () => {
    const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-disc-cli-"));
    try {
      fs.writeFileSync(path.join(outerDir, ".writeup.toml"), '[lint]\ndisabled_rules = ["forbidden_phrase"]\n');
      const innerDir = path.join(outerDir, "sub");
      fs.mkdirSync(innerDir);
      const target = path.join(innerDir, "doc.txt");
      fs.writeFileSync(target, "重要なのは、これだ。\n");
      const { code, stdout } = runCli([target, "--json"]);
      assert.equal(code, 0);
      const out = JSON.parse(stdout);
      assert.ok(!out.findings.some((f) => f.category === "forbidden_phrase"));
    } finally {
      fs.rmSync(outerDir, { recursive: true, force: true });
    }
  });

  test("the CLI (no --config, no ancestor config) falls back to $WRITEUP_STORE", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-store-cli-"));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "wu-target-cli-"));
    try {
      fs.writeFileSync(path.join(storeDir, ".writeup.toml"), '[lint]\ndisabled_rules = ["forbidden_phrase"]\n');
      const target = path.join(targetDir, "doc.txt");
      fs.writeFileSync(target, "重要なのは、これだ。\n");
      const stdout = execFileSync("node", [LINT_BIN, target, "--json"], {
        encoding: "utf-8",
        env: { ...process.env, WRITEUP_STORE: storeDir },
      });
      const out = JSON.parse(stdout);
      assert.ok(!out.findings.some((f) => f.category === "forbidden_phrase"));
    } finally {
      fs.rmSync(storeDir, { recursive: true, force: true });
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CLI-level input errors / exit codes / options
// ---------------------------------------------------------------------------

describe("CLI exit codes and options", () => {
  test("a missing input file exits 1", () => {
    const { code, stderr } = runCli(["/no/such/file.md"]);
    assert.equal(code, 1);
    assert.ok(stderr.includes("見つかりません"));
  });

  test("a directory as input exits 1", () => {
    const { code } = runCli([FIXTURES]);
    assert.equal(code, 1);
  });

  test("an invalid --genre value exits 2", () => {
    const target = path.join(FIXTURES, "clean-natural.txt");
    const { code, stderr } = runCli([target, "--genre", "not-a-real-genre"]);
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });

  test("findings never fail the process: exit 0 even with many findings", () => {
    const { code } = runCli([path.join(FIXTURES, "low-lexical-diversity.txt")]);
    assert.equal(code, 0);
  });

  test("--json output is valid JSON with the expected top-level shape", () => {
    const { stdout } = runCli([path.join(FIXTURES, "clean-natural.txt"), "--json"]);
    const out = JSON.parse(stdout);
    assert.ok("file" in out && "stats" in out && "findings" in out);
    assert.equal(typeof out.stats.totalFindings, "number");
  });

  test("plain (non-JSON) output prints a human-readable report", () => {
    const { stdout } = runCli([path.join(FIXTURES, "clean-natural.txt")]);
    assert.ok(stdout.includes("=== lint:"));
    assert.ok(stdout.includes("検出件数:"));
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance", () => {
  test("linting a ~10k-char document finishes well under 2s (post wasm-init)", async () => {
    const unit = "この提案には利点と懸念があり、担当者は次回の会議で詳細を報告する予定である。";
    let text = "";
    while (text.length < 10000) text += unit;

    // Pay the one-time wasm/tokenizer init cost first so the timed run
    // reflects steady-state throughput, matching how a long-lived process
    // (or a warm test run) would experience it.
    await runLint("ウォームアップ用の短い文です。");

    const start = performance.now();
    const { stats } = await runLint(text);
    const elapsedMs = performance.now() - start;

    console.log(`    [perf] 10k-char lint: ${elapsedMs.toFixed(1)}ms, ${stats.totalFindings} findings`);
    assert.ok(elapsedMs < 2000, `expected < 2000ms, got ${elapsedMs.toFixed(1)}ms`);
  });
});
