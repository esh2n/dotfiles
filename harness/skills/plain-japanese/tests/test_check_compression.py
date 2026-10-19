import check_compression
from samples import SAMPLE_A, SAMPLE_C


def rules(text):
    return [f.rule for f in check_compression.check(text)]


def test_sample_a_findings():
    found = rules(SAMPLE_A)
    assert found.count("symbol_slash") == 2
    assert "verbless_fragment" in found
    assert "label_colon" in found


def test_good_paragraph_has_no_findings():
    assert check_compression.check(SAMPLE_C) == []


def test_verbless_detection():
    assert check_compression.is_verbless("合計 6 本。")
    assert check_compression.is_verbless("結果は「不明」。")
    assert not check_compression.is_verbless("レビュアーは置かない。")
    assert not check_compression.is_verbless("これを使う（理由は後述）。")
    assert not check_compression.is_verbless("どれを選ぶ？")
    assert not check_compression.is_verbless("This is English.")


def test_list_items_may_be_nouns_but_not_symbols():
    assert rules("- 決定メモ\n- 調査記録\n") == []
    assert rules("- 入力 → 出力\n") == ["symbol_arrow"]


def test_arrow_equals_and_slash_in_prose():
    found = rules("検査が失敗するとき、終了コードは 2 になる→書き込まない。家＝ハーネスのことだ。AかBか／両方を選ぶ。\n")
    assert {"symbol_arrow", "symbol_equals", "symbol_slash"} <= set(found)


def test_paths_urls_code_and_tables_are_not_flagged():
    text = (
        "設定は harness/rules/common にある。詳しくは https://example.com/a/b を読む。\n"
        "`a -> b` はコードの中なので対象外である。\n\n| 前 | 後 |\n|---|---|\n| A → B | C／D |\n"
    )
    assert check_compression.check(text) == []


def test_mid_sentence_colon_and_label_colon():
    assert rules("結論：A にする。\n") == ["label_colon"]
    assert rules("この案の結論は次の一点で、つまり：A にすることだ。\n") == ["colon_connector"]


def test_time_and_english_label_are_not_label_colon():
    assert rules("会議は 10:30 に始める。\n") == []
    assert rules("Note: this line is English.\n") == []


def test_hard_wrapped_sentence_is_joined_before_fragment_check():
    assert rules("この文は途中で\n改行されているが、最後は動詞で終わる。\n") == []


def test_symbols_and_colons_written_as_mentions_are_skipped():
    assert rules("文中の「／」「→」「＝」や「一般原則：」のような書き方は使わない。\n") == []


def test_metadata_key_lines_are_exempt():
    assert rules("Status: accepted — 持ち主の裁定（2026-10-19）\n") == []
    assert rules("- **全部を自前で書く**: 却下する。\n") == ["label_colon"]
