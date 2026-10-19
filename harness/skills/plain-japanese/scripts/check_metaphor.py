# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""check_metaphor.py: list metaphors, analogies and personification in Japanese text.

Patterns come from data/metaphors.tsv (metaphor verbs and figure words taken
from nanaism/yomiyasu, plus explanation-analogy markers such as のようなもの,
例えると, いわば). A metaphor that is not in the table (「重心を移す」 was
missing from yomiyasu's list) is not found here; the writer still reads every
paragraph. Inline code, fenced code, URLs and block quotes are skipped, and a
phrase written as a mention (「時間を溶かす」) is not a use.

Usage:
    uv run scripts/check_metaphor.py [FILE|-] [--vocab PATH]... [--json] [--strict]

Extra vocabulary: the nearest .plain-japanese/metaphors.tsv from the current
directory upward, then each --vocab, are added to the skill's table.

Exit status: 0, or 3 with --strict when something is listed; 1 on an input error, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from _common import Finding, classify, exit_code, in_short_quote, print_findings, read_input, snippet

SKILL_DIR = Path(__file__).resolve().parent.parent
DEFAULT_VOCAB = SKILL_DIR / "data" / "metaphors.tsv"
PROJECT_VOCAB = Path(".plain-japanese") / "metaphors.tsv"
SCANNED_KINDS = ("prose", "list", "list-cont", "heading", "table")


@dataclass(frozen=True)
class Pattern:
    kind: str
    regex: re.Pattern[str]
    note: str
    source: str


def load_vocab(path: Path) -> list[Pattern]:
    rows: list[Pattern] = []
    text = path.read_text(encoding="utf-8-sig")
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or line.startswith(("#", "kind\t")):
            continue
        cells = (line.split("\t") + ["", "", "", ""])[:4]
        kind, pattern, note, source = (cell.strip() for cell in cells)
        try:
            rows.append(Pattern(kind, re.compile(pattern), note, source))
        except re.error as error:
            raise ValueError(f"{path}:{number}: bad pattern: {error}") from error
    return rows


def vocab_paths(extra: list[str], cwd: Path) -> list[Path]:
    paths = [DEFAULT_VOCAB]
    for directory in (cwd, *cwd.parents):
        candidate = directory / PROJECT_VOCAB
        if candidate.is_file():
            paths.append(candidate)
            break
    paths.extend(Path(item) for item in extra)
    return paths


def check(text: str, vocab: list[Pattern]) -> list[Finding]:
    findings: list[Finding] = []
    for line in classify(text):
        if line.kind not in SCANNED_KINDS:
            continue
        found = [(m.start(), m.end(), p) for p in vocab for m in p.regex.finditer(line.text) if m.end() > m.start()]
        found.sort(key=lambda item: (item[0], -(item[1] - item[0])))
        last_end = -1
        for start, end, pattern in found:
            if start < last_end or in_short_quote(line.text, start, end):
                continue
            last_end = end
            message = f"{pattern.note}（出典: {pattern.source}）"
            findings.append(Finding(pattern.kind, line.number, snippet(line.text, start, end), message))
    return findings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="List metaphors and analogies.")
    parser.add_argument("file", nargs="?", default="-", help="file to check, or - for stdin (default)")
    parser.add_argument("--vocab", action="append", default=[], help="extra metaphors.tsv (repeatable)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="exit 3 when something is listed")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        vocab = [row for path in vocab_paths(args.vocab, Path.cwd()) for row in load_vocab(path)]
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    findings = check(read_input(args.file), vocab)
    print_findings("metaphor", findings, args.json)
    return exit_code(findings, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
