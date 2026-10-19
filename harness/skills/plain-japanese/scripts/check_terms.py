# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""check_terms.py: flag internal terms in Japanese text, using terms.tsv.

- replace / avoid rows: every use is listed with what to write instead.
- keep+gloss rows: the first use in prose or a list item is listed when no
  explanation sits in the same or the next sentence.
- keep rows: never listed; they document terms that must not be paraphrased.

A term written as a mention (「家」) is not a use and is skipped.

Usage:
    uv run scripts/check_terms.py [FILE|-] [--terms PATH]... [--no-project] [--json] [--strict]
    uv run scripts/check_terms.py --list      # print the merged table

Tables are merged in this order, later rows replacing earlier rows of the same
term (class `off` removes a row): the skill's terms.tsv, the nearest
`.plain-japanese/terms.tsv` from the current directory upward, each path in
PLAIN_JAPANESE_TERMS (os.pathsep-separated), then each --terms.

Exit status: 0, or 3 with --strict when something is listed; 1 on an input error, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from _common import JP_RE, Finding, Line, Sentence, classify, exit_code, print_findings, read_input, sentences, snippet

SKILL_DIR = Path(__file__).resolve().parent.parent
DEFAULT_TABLE = SKILL_DIR / "terms.tsv"
PROJECT_TABLE = Path(".plain-japanese") / "terms.tsv"
CLASSES = ("keep", "keep+gloss", "replace", "avoid", "off")
COLUMNS = ("term", "refers_to", "class", "use_instead", "gloss", "source", "pattern")
SCANNED_KINDS = ("prose", "list", "list-cont", "heading", "table")

_DEFINITION_RE = re.compile(
    r"(?<!こ)とは|という(?:意味|の?は|もの|仕組み|名前|呼び名)|と呼[ぶばびんべ]|を指[すしさ]|のこと[でだ。、]|の意味|つまり|すなわち|、これは"
)
_NEXT_OPENER_RE = re.compile(r"^(?:これは|これを|この|それは|それ|その)")
_NEXT_DEFINITION_RE = re.compile(r"仕組み|を指|(?<!こ)とは|意味|という|役割|機能|のこと")
_GLOSS_TOKEN_RE = re.compile(r"[一-鿿]{2,}|[゠-ヿ]{2,}|[A-Za-z]{3,}")


@dataclass(frozen=True)
class Term:
    term: str
    refers_to: str
    klass: str
    use_instead: str
    gloss: str
    source: str
    regex: re.Pattern[str]


def _parse_row(cells: list[str], origin: str) -> Term:
    cells = (cells + [""] * len(COLUMNS))[: len(COLUMNS)]
    term, refers_to, klass, use_instead, gloss, source, pattern = (cell.strip() for cell in cells)
    if klass not in CLASSES:
        raise ValueError(f"{origin}: unknown class {klass!r} for {term!r}")
    try:
        regex = re.compile(pattern) if pattern else re.compile(re.escape(term))
    except re.error as error:
        raise ValueError(f"{origin}: bad pattern for {term!r}: {error}") from error
    return Term(term, refers_to, klass, use_instead, gloss, source, regex)


def load_table(path: Path) -> list[Term]:
    """Rows of one TSV file. Comment lines (#), blank lines and the header row are skipped."""
    rows: list[Term] = []
    text = path.read_text(encoding="utf-8-sig")
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or line.startswith(("#", "term\t")):
            continue
        rows.append(_parse_row(line.split("\t"), f"{path}:{number}"))
    return rows


def find_project_table(start: Path) -> Path | None:
    for directory in (start, *start.parents):
        candidate = directory / PROJECT_TABLE
        if candidate.is_file():
            return candidate
    return None


def table_paths(extra: list[str], use_project: bool, cwd: Path) -> list[Path]:
    paths = [DEFAULT_TABLE]
    if use_project:
        project = find_project_table(cwd)
        if project is not None:
            paths.append(project)
    env = os.environ.get("PLAIN_JAPANESE_TERMS", "")
    paths.extend(Path(item) for item in env.split(os.pathsep) if item)
    paths.extend(Path(item) for item in extra)
    return paths


def merge_tables(paths: list[Path]) -> list[Term]:
    merged: dict[str, Term] = {}
    for path in paths:
        for row in load_table(path):
            merged[row.term] = row
    return [row for row in merged.values() if row.klass != "off"]


def _is_mention(text: str, start: int, end: int) -> bool:
    return text[start - 1 : start] in ("「", "『", '"') and text[end : end + 1] in ("」", "』", '"')


def _matches(text: str, terms: list[Term]) -> list[tuple[int, int, Term]]:
    """Non-overlapping matches; at one position the longest match wins (家の LLM over 家)."""
    found = [(m.start(), m.end(), t) for t in terms for m in t.regex.finditer(text) if m.end() > m.start()]
    found.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    kept: list[tuple[int, int, Term]] = []
    last_end = -1
    for start, end, term in found:
        if start >= last_end and not _is_mention(text, start, end):
            kept.append((start, end, term))
            last_end = end
    return kept


def _named_in_parentheses(text: str, start: int, end: int) -> bool:
    """True for 「設定を生成する CLI（jig）」: the term is (nearly) the whole parenthetical after its description."""
    opening = max(text.rfind("（", 0, start), text.rfind("(", 0, start))
    if opening < 0 or max(text.rfind("）", opening, start), text.rfind(")", opening, start)) >= 0:
        return False
    closings = [i for i in (text.find("）", end), text.find(")", end)) if i >= 0]
    if not closings:
        return False
    inner = text[opening + 1 : min(closings)].strip()
    return len(inner) <= (end - start) + 6


def _gloss_tokens_hit(term: Term, context: str) -> bool:
    tokens = [token for token in _GLOSS_TOKEN_RE.findall(term.gloss) if token not in term.term]
    if not tokens:
        return False
    hits = sum(1 for token in set(tokens) if token in context)
    return hits >= min(3, len(set(tokens)))


def has_gloss(sentence: str, following: str, start: int, end: int, term: Term) -> bool:
    """True when an explanation of the term appears in the same or the next sentence."""
    if re.match(r"[」』]?\s?[（(][^）)]{2,}", sentence[end:]):
        return True
    if _named_in_parentheses(sentence, start, end):
        return True
    if _DEFINITION_RE.search(sentence[max(0, start - 2) : end + 25]):
        return True
    opens_on_term = _NEXT_OPENER_RE.match(following) or term.regex.match(following)
    if following and opens_on_term and _NEXT_DEFINITION_RE.search(following):
        return True
    return _gloss_tokens_hit(term, sentence + following)


def _use_findings(lines: list[Line], terms: list[Term]) -> list[Finding]:
    findings: list[Finding] = []
    wanted = [t for t in terms if t.klass in ("replace", "avoid")]
    for line in lines:
        if line.kind not in SCANNED_KINDS:
            continue
        for start, end, term in _matches(line.text, wanted):
            verb = "replace" if term.klass == "replace" else "avoid"
            message = f"内輪の言葉（{term.refers_to}）。代わりに: {term.use_instead}"
            findings.append(Finding(f"term_{verb}", line.number, snippet(line.text, start, end), message))
    return findings


def _first_use(sentence_list: list[Sentence], term: Term) -> tuple[int, int, int] | None:
    """First use in a Japanese sentence; English sentences are out of scope for this check."""
    for index, item in enumerate(sentence_list):
        if not JP_RE.search(item.text):
            continue
        for start, end, _ in _matches(item.text, [term]):
            return index, start, end
    return None


def _gloss_findings(lines: list[Line], terms: list[Term]) -> list[Finding]:
    findings: list[Finding] = []
    sentence_list = sentences(lines)
    for term in (t for t in terms if t.klass == "keep+gloss"):
        first = _first_use(sentence_list, term)
        if first is None:
            continue
        index, start, end = first
        current = sentence_list[index]
        following = sentence_list[index + 1].text if index + 1 < len(sentence_list) else ""
        if has_gloss(current.text, following, start, end, term):
            continue
        example = f" 例: {term.term}（{term.gloss}）" if term.gloss else ""
        message = f"初出に説明がない。同じ文か次の文で、何をするものかを書く。{example}"
        findings.append(Finding("term_gloss_missing", current.line, snippet(current.text, start, end), message))
    return findings


def check(text: str, terms: list[Term]) -> list[Finding]:
    lines = classify(text)
    findings = _use_findings(lines, terms) + _gloss_findings(lines, terms)
    return sorted(findings, key=lambda f: (f.line, f.rule))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Flag internal terms using terms.tsv.")
    parser.add_argument("file", nargs="?", default="-", help="file to check, or - for stdin (default)")
    parser.add_argument("--terms", action="append", default=[], help="extra terms.tsv (repeatable)")
    parser.add_argument("--no-project", action="store_true", help="ignore .plain-japanese/terms.tsv")
    parser.add_argument("--list", action="store_true", help="print the merged table and exit")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="exit 3 when something is listed")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        terms = merge_tables(table_paths(args.terms, not args.no_project, Path.cwd()))
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if args.list:
        for term in terms:
            print(f"{term.term}\t{term.klass}\t{term.use_instead or term.gloss}")
        return 0
    findings = check(read_input(args.file), terms)
    print_findings("terms", findings, args.json)
    return exit_code(findings, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
