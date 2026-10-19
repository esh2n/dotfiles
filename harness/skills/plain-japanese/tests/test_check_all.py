import io

import check
from samples import SAMPLE_A, SAMPLE_C


def test_run_all_returns_three_sections(tmp_path):
    results = check.run_all(SAMPLE_A, tmp_path)
    assert set(results) == {"terms", "metaphor", "compression"}
    assert results["terms"] and results["compression"]


def test_main_on_stdin_good_text_exits_zero_even_strict(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO((SAMPLE_C).encode())))
    assert check.main(["--strict"]) == 0
    out = capsys.readouterr().out
    assert "=== terms: 0 ===" in out and "=== compression: 0 ===" in out
