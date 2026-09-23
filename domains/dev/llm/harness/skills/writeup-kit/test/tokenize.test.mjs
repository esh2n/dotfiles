import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenize, joinNounTokens } from "../bin/lib/tokenize.mjs";

describe("tokenize()", () => {
  test("smoke: 医薬品安全管理責任者 tokenizes with pos/baseForm/reading present on every token", async () => {
    const tokens = await tokenize("医薬品安全管理責任者が発表した。");
    assert.ok(tokens.length > 1, "IPADIC should split this into multiple tokens");
    for (const t of tokens) {
      assert.equal(typeof t.surface, "string");
      assert.ok(Array.isArray(t.pos) && t.pos.length === 2);
      assert.equal(typeof t.pos[0], "string");
      assert.equal(typeof t.baseForm, "string");
      assert.equal(typeof t.reading, "string");
      assert.equal(typeof t.begin, "number");
      assert.equal(typeof t.end, "number");
    }
  });

  test("surfaces concatenate back to the input when the input has no whitespace", async () => {
    const text = "医薬品安全管理責任者が発表した。";
    const tokens = await tokenize(text);
    assert.equal(tokens.map((t) => t.surface).join(""), text);
  });

  test("begin/end offsets point back at the token's own surface in the source text", async () => {
    const text = "東京都で新しい方針を発表した。";
    const tokens = await tokenize(text);
    for (const t of tokens) {
      assert.equal(text.slice(t.begin, t.end), t.surface, `offsets for "${t.surface}" should round-trip`);
    }
  });

  test("tokens are in non-decreasing offset order", async () => {
    const tokens = await tokenize("これは重要な事実をもたらす。実装することができる。");
    for (let i = 1; i < tokens.length; i++) {
      assert.ok(tokens[i].begin >= tokens[i - 1].end, "each token should start at or after the previous one ends");
    }
  });

  test("returns [] for empty input", async () => {
    assert.deepEqual(await tokenize(""), []);
  });

  test("baseForm falls back to surface for function words (no dictionary conjugation)", async () => {
    const tokens = await tokenize("これが好きだ。");
    const ga = tokens.find((t) => t.surface === "が");
    assert.ok(ga, "particle が should be tokenized");
    assert.equal(ga.baseForm, "が");
  });

  test("reading is katakana for a known content word", async () => {
    const tokens = await tokenize("医薬品");
    assert.equal(tokens[0].reading, "イヤクヒン");
  });

  test("joinNouns:true option merges 医薬品安全管理責任者 into a single compound token", async () => {
    const plain = await tokenize("医薬品安全管理責任者が発表した。", { joinNouns: false });
    const joined = await tokenize("医薬品安全管理責任者が発表した。", { joinNouns: true });
    assert.ok(plain.length > 5, "plain IPADIC tokenization should split the compound into several nouns");
    const compound = joined.find((t) => t.surface === "医薬品安全管理責任者");
    assert.ok(compound, "joinNouns should merge the noun run into one token");
    assert.deepEqual(compound.pos, ["名詞", "複合"]);
    // Non-noun tokens (助詞/動詞/記号) should pass through unmerged.
    assert.ok(joined.some((t) => t.surface === "が" && t.pos[0] === "助詞"));
    assert.ok(joined.some((t) => t.surface === "。" && t.pos[0] === "記号"));
  });
});

describe("joinNounTokens()", () => {
  test("excludes 名詞,数 (numbers) from the merged run", async () => {
    const tokens = await tokenize("3つの理由がある。");
    const joined = joinNounTokens(tokens);
    // "3" (名詞,数) must stay its own token, never absorbed into a neighboring noun run.
    const three = joined.find((t) => t.surface === "3");
    assert.ok(three, "the numeral token should survive unmerged");
    assert.equal(three.pos[1], "数");
  });

  test("a lone noun token (no adjacent noun) passes through unchanged", async () => {
    const tokens = await tokenize("犬が走る。");
    const joined = joinNounTokens(tokens);
    const dog = joined.find((t) => t.surface === "犬");
    assert.ok(dog);
    assert.deepEqual(dog.pos, ["名詞", "一般"]);
  });

  test("a particle breaks an otherwise-joinable noun run", async () => {
    const tokens = await tokenize("東京都は大都市だ。");
    const joined = joinNounTokens(tokens);
    // 東京 + 都 should merge (both 名詞); は (助詞) must not be absorbed.
    assert.ok(joined.some((t) => t.surface === "東京都" && t.pos[0] === "名詞"));
    assert.ok(joined.some((t) => t.surface === "は" && t.pos[0] === "助詞"));
  });
});
