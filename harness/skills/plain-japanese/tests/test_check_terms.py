import os
from pathlib import Path

import check_terms
from samples import SAMPLE_A, SAMPLE_C


def default_terms():
    return check_terms.merge_tables([check_terms.DEFAULT_TABLE])


def rules(findings):
    return [f.rule for f in findings]


def test_default_table_loads_and_uses_only_known_classes():
    terms = default_terms()
    assert len(terms) >= 25
    assert {t.klass for t in terms} <= {"keep", "keep+gloss", "replace", "avoid"}


def test_sample_a_flags_house_twice_and_reasoning_mode():
    findings = check_terms.check(SAMPLE_A, default_terms())
    snippets = [(f.rule, f.line) for f in findings]
    assert ("term_avoid", 1) in snippets and ("term_avoid", 3) in snippets
    assert ("term_replace", 1) in snippets  # 考え方の型


def test_house_inside_ordinary_words_is_not_flagged():
    text = "専門家と作家が家族の話をした。国家の予算。\n"
    assert check_terms.check(text, default_terms()) == []


def test_mention_in_corner_brackets_is_not_a_use():
    text = "「家」という呼び名は使わない。\n"
    assert check_terms.check(text, default_terms()) == []


def test_longest_match_wins_home_llm_over_house():
    findings = check_terms.check("家の LLM を起動する。\n", default_terms())
    assert len(findings) == 1
    assert "ローカル LLM" in findings[0].message


def test_code_is_not_scanned():
    text = "設定は `家` にある。\n```\n家 床 レーン\n```\n"
    assert check_terms.check(text, default_terms()) == []


def test_keep_gloss_without_explanation_is_listed():
    findings = check_terms.check("jig apply を実行した。結果を見る。\n", default_terms())
    assert rules(findings) == ["term_gloss_missing"]


def test_keep_gloss_with_parenthesis_is_accepted():
    text = "jig（各ツールの設定を生成する CLI）で apply した。\n"
    assert check_terms.check(text, default_terms()) == []


def test_keep_gloss_explained_in_next_sentence_is_accepted():
    text = "まず jig を使う。これは各ツールの設定を生成する CLI のことだ。\n"
    assert check_terms.check(text, default_terms()) == []


def test_keep_gloss_term_inside_parentheses_after_description_is_accepted():
    text = "設定を生成する CLI（jig）を使う。\n"
    assert check_terms.check(text, default_terms()) == []


def test_only_first_use_needs_a_gloss():
    text = "jig（設定を生成する CLI）を使う。あとで jig を再実行する。\n"
    assert check_terms.check(text, default_terms()) == []


def test_good_technical_paragraph_has_no_findings():
    assert check_terms.check(SAMPLE_C, default_terms()) == []


def write_table(path: Path, rows: list[str]) -> Path:
    path.write_text("term\trefers_to\tclass\tuse_instead\tgloss\tsource\tpattern\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return path


def test_project_override_replaces_and_disables_rows(tmp_path, monkeypatch):
    project = tmp_path / "repo"
    (project / ".plain-japanese").mkdir(parents=True)
    write_table(project / ".plain-japanese" / "terms.tsv", ["家\t\toff\t\t\t\t", "ほげ\t社内の呼び名\treplace\tふつうの名前\t\ttest\t"])
    nested = project / "sub"
    nested.mkdir()
    monkeypatch.delenv("PLAIN_JAPANESE_TERMS", raising=False)
    terms = check_terms.merge_tables(check_terms.table_paths([], True, nested))
    findings = check_terms.check("家でほげを使う。\n", terms)
    assert [f.snippet for f in findings] == ["家でほげを使う。"]
    assert "ふつうの名前" in findings[0].message


def test_env_and_flag_tables_are_merged_in_order(tmp_path, monkeypatch):
    env_table = write_table(tmp_path / "env.tsv", ["ふが\t\treplace\tenv の語\t\t\t"])
    flag_table = write_table(tmp_path / "flag.tsv", ["ふが\t\treplace\tflag の語\t\t\t"])
    monkeypatch.setenv("PLAIN_JAPANESE_TERMS", str(env_table))
    paths = check_terms.table_paths([str(flag_table)], False, tmp_path)
    terms = check_terms.merge_tables(paths)
    findings = check_terms.check("ふがを使う。\n", terms)
    assert "flag の語" in findings[0].message


def test_bad_class_is_an_error(tmp_path):
    table = write_table(tmp_path / "bad.tsv", ["x\t\tweird\t\t\t\t"])
    try:
        check_terms.load_table(table)
    except ValueError as error:
        assert "unknown class" in str(error)
    else:
        raise AssertionError("expected ValueError")


def test_main_reads_stdin_and_strict_exits_2(monkeypatch, capsys):
    import io

    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO(("家で決める。\n").encode())))
    monkeypatch.chdir(Path(os.sep))
    assert check_terms.main(["-", "--strict", "--no-project"]) == 3
    assert "term_avoid" in capsys.readouterr().out


def test_main_missing_file_exits_1(tmp_path):
    try:
        check_terms.main([str(tmp_path / "missing.md"), "--no-project"])
    except SystemExit as stop:
        assert stop.code == 1
    else:
        raise AssertionError("expected SystemExit")


def test_term_inside_an_unrelated_note_is_not_glossed():
    text = "記号を使わない（pstack の unslop 規則 33 を移したもの）。\n"
    assert rules(check_terms.check(text, default_terms())) == ["term_gloss_missing"]


def test_definition_marker_must_be_near_the_term():
    far = "pstack を使う。ここで言う家とは、このリポジトリの規則の一式のことで、ほかの意味はない。\n"
    assert "term_gloss_missing" in rules(check_terms.check(far, default_terms()))
    near = "pstack とは、Cursor が公開している skill のパックである。\n"
    assert check_terms.check(near, default_terms()) == []


def test_english_sentences_are_not_checked_for_glosses():
    assert check_terms.check("Run jig apply with the same effort.\n", default_terms()) == []
