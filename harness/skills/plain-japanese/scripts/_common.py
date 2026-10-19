"""Shared text handling for the plain-japanese checks. Python stdlib only.

Reads a file or stdin, classifies Markdown lines, hides code and URLs so the
checks never fire inside them, and splits Japanese prose into sentences with
their line numbers. Detection by machine, judgment by the writer: every check
built on this module only lists suspects.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

JP_CHAR = r"぀-ヿ㐀-䶿一-鿿々"
JP_RE = re.compile(f"[{JP_CHAR}]")
HIRAGANA_RE = re.compile(r"[぀-ゟ]")

_FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
_FRONT_KEY_RE = re.compile(r"^[A-Za-z_][\w-]*\s*:")
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s")
_TABLE_RE = re.compile(r"^\s*\|")
_LIST_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+")
_QUOTE_RE = re.compile(r"^\s*>")
_HTML_RE = re.compile(r"^\s*<[A-Za-z/!]")
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
_URL_RE = re.compile(r"https?://[^\s)\]>」）]+")
_LINK_TARGET_RE = re.compile(r"\]\([^)\s]*\)")
_SENTENCE_END_RE = re.compile(r"[。！？!?]+[」』）)\]]*")


@dataclass(frozen=True)
class Line:
    number: int  # 1-based
    kind: str  # prose | list | list-cont | heading | table | quote | code | html | blank | frontmatter
    text: str  # masked: code and URLs replaced with spaces of the same length
    raw: str


@dataclass(frozen=True)
class Sentence:
    line: int
    text: str
    kind: str  # kind of the line the sentence starts on


@dataclass(frozen=True)
class Finding:
    rule: str
    line: int
    snippet: str
    message: str
    severity: str = "warn"


def read_input(path: str | None) -> str:
    """Read the file at `path`, or stdin when `path` is None or '-'. Exit 1 on an input error."""
    try:
        if path in (None, "-"):
            data = sys.stdin.buffer.read()
        else:
            data = Path(path).read_bytes()
        return data.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    except (OSError, UnicodeDecodeError) as error:
        print(f"error: cannot read {path or 'stdin'}: {error}", file=sys.stderr)
        raise SystemExit(1) from error


def _blank_out(match: re.Match[str]) -> str:
    return " " * len(match.group(0))


def mask_inline(text: str) -> str:
    """Replace inline code, URLs and Markdown link targets with spaces, keeping offsets."""
    text = _INLINE_CODE_RE.sub(_blank_out, text)
    text = _LINK_TARGET_RE.sub(_blank_out, text)
    return _URL_RE.sub(_blank_out, text)


def _kind_of(raw: str) -> str:
    if not raw.strip():
        return "blank"
    if _HEADING_RE.match(raw):
        return "heading"
    if _TABLE_RE.match(raw):
        return "table"
    if _QUOTE_RE.match(raw):
        return "quote"
    if _HTML_RE.match(raw):
        return "html"
    if _LIST_RE.match(raw):
        return "list"
    return "prose"


def _front_matter_end(raws: list[str]) -> int:
    """Line number of the closing --- of a YAML front matter block at the top, or 0."""
    if not raws or raws[0].strip() != "---":
        return 0
    for index, raw in enumerate(raws[1:], start=2):
        if raw.strip() == "---":
            return index
        if raw.strip() and not raw.startswith((" ", "-")) and not _FRONT_KEY_RE.match(raw):
            return 0
    return 0


def _fence_step(raw: str, fence: str) -> tuple[bool, str]:
    """(is a fence line, open fence marker after this line). A closer repeats the opener's character, at least as long."""
    match = _FENCE_RE.match(raw)
    if not match:
        return False, fence
    marker, rest = match.group(1), match.group(2)
    if fence:
        closes = marker[0] == fence[0] and len(marker) >= len(fence) and not rest.strip()
        return True, "" if closes else fence
    if marker[0] == "`" and "`" in rest:
        return False, ""  # ```inline``` on one line is not a fence
    return True, marker


def classify(text: str) -> list[Line]:
    """Classify every line; fenced code is kind 'code', a leading YAML block is 'frontmatter'."""
    lines: list[Line] = []
    fence = ""
    raws = text.split("\n")
    if raws and raws[-1] == "":
        raws.pop()
    front_end = _front_matter_end(raws)
    for number, raw in enumerate(raws, start=1):
        if number <= front_end:
            lines.append(Line(number, "frontmatter", "", raw))
            continue
        was_open = bool(fence)
        is_fence, fence = _fence_step(raw, fence)
        if is_fence or was_open:
            lines.append(Line(number, "code", "", raw))
            continue
        kind = _kind_of(raw)
        if kind == "prose" and raw[:1].isspace() and lines and lines[-1].kind in ("list", "list-cont"):
            kind = "list-cont"
        lines.append(Line(number, kind, mask_inline(raw), raw))
    return lines


def strip_list_marker(text: str) -> str:
    return _LIST_RE.sub("", text, count=1)


@dataclass
class Block:
    kind: str  # prose | list
    text: str = ""
    marks: list[tuple[int, int]] | None = None  # (offset in text, source line number)

    def add(self, number: int, piece: str) -> None:
        if self.marks is None:
            self.marks = []
        if self.text:
            self.text += "" if JP_RE.search(self.text[-1:]) else " "
        self.marks.append((len(self.text), number))
        self.text += piece

    def line_at(self, offset: int) -> int:
        number = self.marks[0][1] if self.marks else 0
        for start, line in self.marks or []:
            if start <= offset:
                number = line
        return number


def blocks(lines: list[Line]) -> list[Block]:
    """Join consecutive prose lines into paragraphs; a list item with its continuation lines is one block.

    Japanese lines are joined without a space, other lines with one, so
    hard-wrapped Markdown splits into the same sentences as unwrapped text.
    Each block remembers which source line every part came from.
    """
    out: list[Block] = []
    current: Block | None = None
    for line in lines:
        continues = current is not None and (current.kind, line.kind) in (("prose", "prose"), ("list", "list-cont"))
        if continues and current is not None:
            current.add(line.number, line.text.strip())
        elif line.kind in ("prose", "list"):
            text = strip_list_marker(line.text) if line.kind == "list" else line.text
            current = Block(line.kind)
            current.add(line.number, text.strip())
            out.append(current)
        else:
            current = None
    return out


def split_sentences(text: str) -> list[str]:
    """Split on 。！？!? (keeping closing brackets); a trailing piece without one is a sentence too."""
    return [piece for _, piece in split_with_offsets(text)]


def split_with_offsets(text: str) -> list[tuple[int, str]]:
    pieces: list[tuple[int, str]] = []
    position = 0
    ends = [match.end() for match in _SENTENCE_END_RE.finditer(text)] + [len(text)]
    for end in ends:
        raw = text[position:end]
        piece = raw.strip()
        if piece:
            pieces.append((position + len(raw) - len(raw.lstrip()), piece))
        position = end
    return pieces


def sentences(lines: list[Line]) -> list[Sentence]:
    """Sentences of prose paragraphs and list items, each tagged with the line it starts on."""
    out: list[Sentence] = []
    for block in blocks(lines):
        out.extend(Sentence(block.line_at(offset), piece, block.kind) for offset, piece in split_with_offsets(block.text))
    return out


def in_short_quote(text: str, start: int, end: int, max_inner: int = 15) -> bool:
    """True when text[start:end] sits inside a short 「…」 or 『…』: a mention of the words, not a use."""
    for opening_mark, closing_mark in (("「", "」"), ("『", "』")):
        opening = text.rfind(opening_mark, 0, start + 1)
        if opening < 0 or closing_mark in text[opening + 1 : start]:
            continue
        closing = text.find(closing_mark, max(end - 1, opening + 1))
        if closing >= 0 and closing - opening - 1 <= max(max_inner, end - start):
            return True
    return False


def snippet(text: str, start: int, end: int, width: int = 18) -> str:
    left = max(0, start - width)
    right = min(len(text), end + width)
    return text[left:right].strip()


def print_findings(title: str, findings: list[Finding], as_json: bool) -> None:
    if as_json:
        print(json.dumps([asdict(f) for f in findings], ensure_ascii=False, indent=2))
        return
    print(f"=== {title}: {len(findings)} ===")
    for finding in findings:
        print(f"L{finding.line} [{finding.severity}] {finding.rule}: {finding.snippet}")
        print(f"    {finding.message}")


STRICT_EXIT = 3


def exit_code(findings: list[Finding], strict: bool) -> int:
    """0 normally; 3 when --strict and something was found. Input errors exit 1, usage errors 2."""
    return STRICT_EXIT if strict and findings else 0
