import diff_content
from samples import SAMPLE_B

REWRITE_B = "この変更は、気づかないうちにおかしくなる箇所を一つずつ直していく。目立たないながらも効果はあるが、放っておくと時間を取られる。重心を移すのが大事だ。"


def test_added_adverbial_phrase_is_listed():
    result = diff_content.compare(SAMPLE_B, REWRITE_B)
    assert "一つずつ" in result["adverbials"]["added"]
    assert "一つ" in result["numbers"]["added"]


def test_added_and_removed_words():
    result = diff_content.compare(SAMPLE_B, REWRITE_B)
    assert "効果" in result["words"]["added"]
    assert "地味" in result["words"]["removed"]


def test_negation_changes_are_listed():
    result = diff_content.compare("設定を変える。", "設定を変えない。")
    assert result["negations"]["added"] == ["定を変えない"]  # four characters of context
    assert result["negations"]["removed"] == []


def test_number_changes_are_counted():
    result = diff_content.compare("3 件と 5 秒。", "4 件と 5 秒。")
    assert result["numbers"] == {"added": ["4件"], "removed": ["3件"]}


def test_full_width_digits_are_normalized():
    result = diff_content.compare("３件", "3 件")
    assert result["numbers"] == {"added": [], "removed": []}


def test_certainty_and_ranking_added():
    result = diff_content.compare("この方法を使う。", "この方法が最も確実に効く。必ず使う。")
    added = result["qualifiers"]["added"]
    assert "ranking:最も" in added and "certainty:必ず" in added
    assert "確実に" in result["adverbials"]["added"]


def test_identical_text_has_no_changes():
    assert not diff_content.has_changes(diff_content.compare(SAMPLE_B, SAMPLE_B))


def test_main_strict_and_stdin(tmp_path, monkeypatch, capsys):
    import io

    original = tmp_path / "a.md"
    original.write_text(SAMPLE_B, encoding="utf-8")
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO((REWRITE_B).encode())))
    assert diff_content.main([str(original), "-", "--strict"]) == 3
    assert "一つずつ" in capsys.readouterr().out
    assert diff_content.main(["-", "-"]) == 1
