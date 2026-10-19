import check_metaphor
from samples import SAMPLE_A, SAMPLE_C


def vocab():
    return check_metaphor.load_vocab(check_metaphor.DEFAULT_VOCAB)


def kinds(text):
    return [f.kind if hasattr(f, "kind") else f.rule for f in check_metaphor.check(text, vocab())]


def test_vocab_loads_with_yomiyasu_and_own_rows():
    rows = vocab()
    sources = {row.source.split("@")[0].split(" ")[0] for row in rows}
    assert "nanaism/yomiyasu" in sources and "plain-japanese" in sources
    assert sum(1 for row in rows if row.source.startswith("nanaism/yomiyasu")) >= 16


def test_sample_b_finds_all_five_metaphors():
    from samples import SAMPLE_B

    findings = check_metaphor.check(SAMPLE_B, vocab())
    joined = " ".join(f.message for f in findings)
    assert len(findings) == 5
    for word in ("静かに壊れる", "潰す", "効く", "時間を溶かす", "重心を移す"):
        assert word in joined


def test_analogy_markers_are_listed():
    text = "キャッシュは冷蔵庫のようなもの。例えると図書館だ。いわば台所である。\n"
    assert kinds(text) == ["analogy", "analogy", "analogy"]


def test_literal_effect_is_not_flagged():
    text = "キャッシュが効いているので速い。設定が効く。効率と効果を測る。\n"
    assert check_metaphor.check(text, vocab()) == []


def test_personification_and_slang():
    text = "コードが語る。ログを吐く。サーバーが死んだ。\n"
    assert kinds(text) == ["personification", "slang", "slang"]


def test_mention_in_brackets_is_skipped():
    text = "「時間を溶かす」という言い方は使わない。\n"
    assert check_metaphor.check(text, vocab()) == []


def test_code_and_quotes_are_skipped():
    text = "`時間を溶かす`\n> 静かに壊れる\n"
    assert check_metaphor.check(text, vocab()) == []


def test_samples_a_and_c_have_no_findings():
    assert check_metaphor.check(SAMPLE_A, vocab()) == []
    assert check_metaphor.check(SAMPLE_C, vocab()) == []


def test_project_vocab_is_added(tmp_path):
    (tmp_path / ".plain-japanese").mkdir()
    (tmp_path / ".plain-japanese" / "metaphors.tsv").write_text("kind\tpattern\tnote\tsource\nfigure\t船出\t比喩\ttest\n", encoding="utf-8")
    paths = check_metaphor.vocab_paths([], tmp_path)
    rows = [row for path in paths for row in check_metaphor.load_vocab(path)]
    assert [f.rule for f in check_metaphor.check("新しい船出だ。\n", rows)] == ["figure"]
