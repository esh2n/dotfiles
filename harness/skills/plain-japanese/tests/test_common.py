from _common import blocks, classify, mask_inline, sentences, split_sentences


def test_mask_inline_hides_code_and_urls_keeping_length():
    text = "見る `a/b → c` と https://example.com/x を"
    masked = mask_inline(text)
    assert len(masked) == len(text)
    assert "→" not in masked and "example" not in masked


def test_classify_marks_fenced_code_headings_tables_lists_quotes():
    text = "# 見出し\n本文。\n```\ncode → x\n```\n| a | b |\n- 項目\n> 引用\n"
    kinds = [line.kind for line in classify(text)]
    assert kinds == ["heading", "prose", "code", "code", "code", "table", "list", "quote"]


def test_blocks_join_hard_wrapped_japanese_without_space():
    lines = classify("前半の文が\n続いている。\n\n次の段落。\n")
    assert [block.text for block in blocks(lines)] == ["前半の文が続いている。", "次の段落。"]


def test_split_sentences_keeps_closing_brackets_and_trailing_piece():
    assert split_sentences("「はい。」と言った。残り") == ["「はい。」", "と言った。", "残り"]


def test_sentences_carry_their_line_number():
    found = sentences(classify("一行目。\n\n三行目の文。二つ目。\n"))
    assert [(s.line, s.text) for s in found] == [(1, "一行目。"), (3, "三行目の文。"), (3, "二つ目。")]


def test_front_matter_is_not_prose():
    kinds = [line.kind for line in classify("---\ntitle: 家\n---\n本文。\n")]
    assert kinds == ["frontmatter", "frontmatter", "frontmatter", "prose"]
