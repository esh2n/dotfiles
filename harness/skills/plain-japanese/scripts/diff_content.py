# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""diff_content.py: list what a rewrite added to or removed from the original.

The idea of yomiyasu's diff and natural-japanese's newfacts.py, restated: a
rewrite must not add facts, rankings, numbers or certainty, and must not drop
content. This script lists, for original A and rewrite B:

- content words (kanji runs, katakana runs, Latin words) only in B / only in A
- numbers, including kanji numerals with a counter (一つ, 三件), by count
- negations, by the words around them
- certainty, ranking and scope words (必ず, 最も, すべて, だけ, ...)
- adverbial phrases (一つずつ, 段階的に, まとめて, ...), the class that
  yomiyasu's diff missed when a rewrite slipped in 「一つずつ」

It does not judge; the writer checks each listed item against the source.

Usage:
    uv run scripts/diff_content.py ORIGINAL REWRITE [--json]
    uv run scripts/diff_content.py ORIGINAL -        # rewrite from stdin

Exit status: 0, or 3 with --strict when anything was added or removed; 1 on an input error, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter

from _common import STRICT_EXIT, read_input

_CONTENT_RE = re.compile(r"[一-鿿々]+|[゠-ヿ]{2,}|[A-Za-z][A-Za-z0-9_.\-]*")
_KANJI_NUMERAL = "一二三四五六七八九十百千万両"
_COUNTERS = "つ件個本回行日倍人台段点割番度枚社名項章節種歩桁秒分年月週時"
_NUMBER_RE = re.compile(
    rf"\d+(?:[.,]\d+)*\s?(?:%|ms|KB|MB|GB|TB|KiB|MiB|GiB|時間|[{_COUNTERS}])?"
    rf"|[{_KANJI_NUMERAL}]+(?=[{_COUNTERS}])[{_COUNTERS}]"
    r"|ひとつ|ふたつ|みっつ|よっつ|いつつ"
)
_NEGATION_RE = re.compile(
    r"(?<![少危幼汚切])(?:ない|なかっ|なく|ません|ませんでし|(?<!ま)(?<!えず)(?<!必)(?<!思わ)(?<!わずか)ず(?=[、。にとも])|(?<!死)ぬ(?=[。、])|無し|なし|不要|禁止|しない|できない)"
)
_CERTAINTY = r"必ず|かならず|確実に|絶対|間違いなく|明らかに|当然|おそらく|たぶん|多分|きっと|はず|に違いない|かもしれ|だろう|でしょう|と思われ|と考えられ|らしい|ようだ|可能性が"
_RANKING = r"最も|もっとも|一番|いちばん|最大|最小|最高|最低|最優先|最重要|唯一|第一|首位|トップ|ベスト|随一"
_SCOPE = r"すべて|全て|全部|ぜんぶ|常に|つねに|いつも|毎回|どれも|いずれも|一切|決して|ほとんど|ほぼ|大半|大幅|かなり|非常に|とても|少し|わずか|だけ|のみ|しか|特に|主に|一部|まったく|完全に"
_QUALIFIER_RE = re.compile(f"(?P<certainty>{_CERTAINTY})|(?P<ranking>{_RANKING})|(?P<scope>{_SCOPE})")
_ADVERBIAL_RE = re.compile(
    rf"(?:[{_KANJI_NUMERAL}\d]+[つ件個本行人]|ひとつ|ふたつ|少し|すこし|[一-鿿]{{1,3}})ずつ"
    r"|ひとつひとつ|一つ一つ|一つひとつ|逐一|順に|順番に|順次|一気に|一度に|同時に|即座に|直ちに|すぐに|徐々に|次第に|段階的に"
    r"|確実に|慎重に|丁寧に|自動的に|自動で|手動で|事前に|あらかじめ|まとめて|個別に|随時|常時|定期的に|毎日|改めて|あえて"
    r"|わざわざ|とりあえず|ひとまず|いったん|再び|ふたたび|なるべく|できるだけ|しっかり|きちんと|ちゃんと|じっくり|まず|さらに|もっと"
)


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def content_words(text: str) -> set[str]:
    numerals = set(_KANJI_NUMERAL)
    words = (w.rstrip(".-") for w in _CONTENT_RE.findall(text))
    return {w for w in words if w and not set(w) <= numerals}


def numbers(text: str) -> Counter[str]:
    return Counter(re.sub(r"\s+", "", m.group(0)) for m in _NUMBER_RE.finditer(text))


def negations(text: str) -> Counter[str]:
    """Each negation keyed by up to four characters before it, so 置かない and 使わない differ."""
    keys = Counter()
    for match in _NEGATION_RE.finditer(text):
        before = re.sub(r"\W", "", text[max(0, match.start() - 4) : match.start()])
        keys[before + match.group(0)] += 1
    return keys


def qualifiers(text: str) -> Counter[str]:
    return Counter(f"{m.lastgroup}:{m.group(0)}" for m in _QUALIFIER_RE.finditer(text))


def adverbials(text: str) -> Counter[str]:
    return Counter(m.group(0) for m in _ADVERBIAL_RE.finditer(text))


def _counter_diff(a: Counter[str], b: Counter[str]) -> dict[str, list[str]]:
    added = sorted((b - a).elements())
    removed = sorted((a - b).elements())
    return {"added": added, "removed": removed}


def compare(original: str, rewrite: str) -> dict[str, dict[str, list[str]]]:
    a, b = normalize(original), normalize(rewrite)
    words_a, words_b = content_words(a), content_words(b)
    return {
        "words": {"added": sorted(words_b - words_a), "removed": sorted(words_a - words_b)},
        "numbers": _counter_diff(numbers(a), numbers(b)),
        "negations": _counter_diff(negations(a), negations(b)),
        "qualifiers": _counter_diff(qualifiers(a), qualifiers(b)),
        "adverbials": _counter_diff(adverbials(a), adverbials(b)),
    }


_TITLES = {
    "words": "内容語（元にない語は事実を足していないか、消えた語は内容を落としていないか）",
    "numbers": "数値",
    "negations": "否定（打ち消しの増減で意味が反転していないか）",
    "qualifiers": "確信度・順位・範囲の語（certainty / ranking / scope）",
    "adverbials": "副詞句（一つずつ、段階的に、など。元にない手順や頻度を足していないか）",
}


def render(result: dict[str, dict[str, list[str]]]) -> str:
    out = ["=== diff_content ==="]
    for key, title in _TITLES.items():
        added, removed = result[key]["added"], result[key]["removed"]
        out.append(f"■ {title}")
        out.append("  + " + ("、".join(added) if added else "（なし）"))
        out.append("  - " + ("、".join(removed) if removed else "（なし）"))
    return "\n".join(out)


def has_changes(result: dict[str, dict[str, list[str]]]) -> bool:
    return any(side for entry in result.values() for side in entry.values())


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="List content added or removed by a rewrite.")
    parser.add_argument("original", help="original text file, or - for stdin")
    parser.add_argument("rewrite", help="rewritten text file, or - for stdin")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="exit 3 when anything changed")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.original == "-" and args.rewrite == "-":
        print("error: only one of ORIGINAL and REWRITE can be stdin", file=sys.stderr)
        return 1
    result = compare(read_input(args.original), read_input(args.rewrite))
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else render(result))
    return STRICT_EXIT if args.strict and has_changes(result) else 0


if __name__ == "__main__":
    raise SystemExit(main())
