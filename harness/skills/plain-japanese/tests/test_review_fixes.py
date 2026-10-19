"""Regression tests for the issues found in the first review of the scripts."""

import io

import check_compression
import check_terms
import diff_content
from _common import classify, read_input, sentences


def terms():
    return check_terms.merge_tables([check_terms.DEFAULT_TABLE])


def test_sentence_line_numbers_follow_hard_wraps():
    text = "一行目の文は\n途中で折り返す。\n三行目で 6 本。\n"
    found = check_compression.check(text)
    assert [(f.rule, f.line) for f in found] == [("verbless_fragment", 3)]


def test_nested_fences_keep_inner_code_out():
    text = "````\n```python\n家 → 床\n```\n````\n本文で動く。\n"
    kinds = [line.kind for line in classify(text)]
    assert kinds[:5] == ["code"] * 5 and kinds[5] == "prose"


def test_one_line_triple_backticks_do_not_open_a_fence():
    kinds = [line.kind for line in classify("```code```\n本文 → 結果。\n")]
    assert kinds[1] == "prose"


def test_trailing_colon_and_emphasis_are_not_fragments():
    assert not check_compression.is_verbless("次のコマンドを実行する：")
    assert not check_compression.is_verbless("こうするのが **重要です**。")


def test_list_continuation_lines_join_their_item():
    text = "- 設定ファイルを\n  生成する\n"
    assert [s.text for s in sentences(classify(text))] == ["設定ファイルを生成する"]
    assert check_compression.check(text) == []


def test_kotowa_is_not_a_definition_and_next_sentence_must_open_on_the_term():
    assert check_terms.check("jig を直すことは難しい。\n", terms())
    assert check_terms.check("jig を使う。あとで jig を使うことが大事だ。\n", terms())


def test_masu_and_kanarazu_are_not_negations():
    result = diff_content.compare("設定を見る。", "まず、必ず、設定を見る。")
    assert result["negations"]["added"] == []


def test_latin_tokens_drop_trailing_punctuation():
    assert diff_content.content_words("run foo.") == {"run", "foo"}


def test_slash_in_unquoted_paths_is_not_symbol_speak():
    assert check_compression.check("設定は docs/設計/決定.md にある。\n") == []


def test_long_space_runs_are_fast():
    assert check_compression.is_verbless("結果" + " " * 50000 + "。") is True


def test_horizontal_rule_is_not_front_matter():
    kinds = [line.kind for line in classify("---\n本文で動く。\n---\n")]
    assert kinds[1] == "prose"


def test_stdin_with_bom_and_crlf(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO("\ufeff一行目。\r\n二行目。\r\n".encode())))
    assert read_input("-") == "一行目。\n二行目。\n"


def test_invalid_utf8_on_stdin_exits_1(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO(b"\xff\xfe\xfa")))
    try:
        read_input("-")
    except SystemExit as stop:
        assert stop.code == 1
    else:
        raise AssertionError("expected SystemExit")
