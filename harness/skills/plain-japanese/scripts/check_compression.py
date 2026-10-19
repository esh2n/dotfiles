# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""check_compression.py: list over-compressed Japanese that the reader has to decode.

The Japanese counterpart of pstack unslop rule 33 (dropped verbs, symbol-speak)
and technical-writing's no-slash rule. Rules:

- verbless_fragment: a prose sentence that ends without a predicate
  (「6 本。」, 「結果はエラー。」). Detected by the last character before the
  sentence end not being hiragana. List items are exempt: a list of nouns is fine.
- symbol_slash: ／, or / between Japanese words, in prose or a list item.
- symbol_arrow: → ⇒ -> => and the like in prose or a list item.
- symbol_equals: ＝, or = between Japanese words.
- label_colon: a line that opens with a short label and a colon (「一般原則：…」).
  Metadata keys in ASCII (`Status: …`, `rule: …`) are exempt.
- colon_connector: a full-width colon in the middle of a sentence.

Tables, headings, code, URLs and block quotes are skipped, and so is a symbol
written as a mention inside a short 「…」 (「／」を使わない).

Usage:
    uv run scripts/check_compression.py [FILE|-] [--json] [--strict]

Exit status: 0, or 3 with --strict when something is listed; 1 on an input error, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import re

from _common import (
    JP_CHAR,
    JP_RE,
    Finding,
    Line,
    classify,
    exit_code,
    in_short_quote,
    print_findings,
    read_input,
    sentences,
    snippet,
    strip_list_marker,
)

_SLASH_RE = re.compile(f"／|(?<=[{JP_CHAR}])/(?=[{JP_CHAR}])")
_ARROW_RE = re.compile(r"[→⇒⟶➡⇨↦]|(?<![-=<])(?:->|=>)(?!>)")
_EQUALS_RE = re.compile(f"＝|(?<=[{JP_CHAR}])\\s?=\\s?(?=[{JP_CHAR}])")
_LABEL_RE = re.compile(r"^(?P<label>[^\s：:。、！？]{1,15})\s?(?:：|:\s)\s*\S")
_MID_COLON_RE = re.compile(r"：")
_METADATA_KEY_RE = re.compile(r"^(?:[-*+]\s+)?[A-Za-z][\w-]*:\s")
_TRAILING_BRACKETS_RE = re.compile(r"[」』）)\]:：*_~…]+$")
_TRAILING_PAREN_NOTE_RE = re.compile(r"[（(][^（）()]*[）)]$")
_TERMINAL_RE = re.compile(r"[。！？!?]+$")
_PROSE_KINDS = ("prose", "list")


def _sentence_tail(sentence: str) -> str:
    """The sentence without end punctuation, closing brackets and final notes in parentheses."""
    body = sentence.strip()
    previous = None
    while previous != body:
        previous = body
        body = _TERMINAL_RE.sub("", body.rstrip()).rstrip()
        if _TRAILING_PAREN_NOTE_RE.search(body):
            body = _TRAILING_PAREN_NOTE_RE.sub("", body).rstrip()
        else:
            body = _TRAILING_BRACKETS_RE.sub("", body).rstrip()
    return body


def is_verbless(sentence: str) -> bool:
    """True when a Japanese sentence ends on something other than hiragana (no predicate)."""
    if not JP_RE.search(sentence) or sentence.rstrip().endswith(("？", "?")):
        return False
    body = _sentence_tail(sentence)
    if not body:
        return False
    last = body[-1]
    return not ("぀" <= last <= "ゟ")


def _fragment_findings(lines: list[Line]) -> list[Finding]:
    findings: list[Finding] = []
    for item in sentences(lines):
        if item.kind == "prose" and not _METADATA_KEY_RE.match(item.text) and is_verbless(item.text):
            message = "述語のない断片。主語と述語のある文にする（何が、どうするのか）。"
            findings.append(Finding("verbless_fragment", item.line, item.text[-40:], message))
    return findings


_SYMBOL_RULES = (
    (_SLASH_RE, "symbol_slash", "「／」で語を並べない。「AとB」「AまたはB」「AかB、または両方」と書く。"),
    (_ARROW_RE, "symbol_arrow", "矢印で関係を書かない。「AするとBになる」「AからBへ移す」のように動詞で書く。"),
    (_EQUALS_RE, "symbol_equals", "「＝」で言い換えない。「AはBのこと」「AはBを指す」と文で書く。"),
)


def _in_path(text: str, position: int) -> bool:
    """True when the symbol sits in a path-like token such as docs/設計/決定.md."""
    left = len(text[:position]) - len(re.split(r"\s", text[:position])[-1])
    right_match = re.search(r"\s", text[position:])
    token = text[left : position + (right_match.start() if right_match else len(text) - position)]
    return "." in token or token.count("/") >= 2


def _symbol_findings(line: Line) -> list[Finding]:
    findings: list[Finding] = []
    for regex, rule, message in _SYMBOL_RULES:
        for match in regex.finditer(line.text):
            if in_short_quote(line.text, match.start(), match.end()) or _in_path(line.text, match.start()):
                continue
            findings.append(Finding(rule, line.number, snippet(line.text, match.start(), match.end()), message))
    return findings


def _colon_findings(line: Line) -> list[Finding]:
    body = strip_list_marker(line.text).strip() if line.kind == "list" else line.text.strip()
    if not JP_RE.search(body):
        return []
    findings: list[Finding] = []
    label = None if _METADATA_KEY_RE.match(body) else _LABEL_RE.match(body)
    label_colon_at = -1
    if label:
        label_colon_at = label.end("label") + 1
        message = "ラベルとコロンで始めない。ラベルの中身を文に入れる（「一般原則は principle-* を参照する」）。"
        findings.append(Finding("label_colon", line.number, body[:30], message))
    for match in _MID_COLON_RE.finditer(body):
        if match.start() <= label_colon_at or in_short_quote(body, match.start(), match.end()):
            continue
        message = "文の途中のコロンでつながない。接続の言葉（「つまり」「たとえば」「理由は」）か、文を分けて書く。"
        findings.append(Finding("colon_connector", line.number, snippet(body, match.start(), match.end()), message))
    return findings


def check(text: str) -> list[Finding]:
    lines = classify(text)
    findings = _fragment_findings(lines)
    for line in lines:
        if line.kind in _PROSE_KINDS:
            findings.extend(_symbol_findings(line))
            findings.extend(_colon_findings(line))
        elif line.kind == "list-cont":
            findings.extend(_symbol_findings(line))
    return sorted(findings, key=lambda f: (f.line, f.rule))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="List over-compressed Japanese.")
    parser.add_argument("file", nargs="?", default="-", help="file to check, or - for stdin (default)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="exit 3 when something is listed")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    findings = check(read_input(args.file))
    print_findings("compression", findings, args.json)
    return exit_code(findings, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
