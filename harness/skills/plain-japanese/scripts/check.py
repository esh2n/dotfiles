# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""check.py: run the terms, metaphor and compression checks on one text.

Usage:
    uv run scripts/check.py [FILE|-] [--json] [--strict]

Meant for chat replies too: pipe the draft in (`... | uv run scripts/check.py`).
The tables are merged the same way as in check_terms.py and check_metaphor.py
(the skill's tables, then the project's .plain-japanese/ files).

Exit status: 0, or 3 with --strict when something is listed; 1 on an input error, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

import check_compression
import check_metaphor
import check_terms
from _common import exit_code, print_findings, read_input


def run_all(text: str, cwd: Path) -> dict[str, list]:
    terms = check_terms.merge_tables(check_terms.table_paths([], True, cwd))
    vocab = [row for path in check_metaphor.vocab_paths([], cwd) for row in check_metaphor.load_vocab(path)]
    return {
        "terms": check_terms.check(text, terms),
        "metaphor": check_metaphor.check(text, vocab),
        "compression": check_compression.check(text),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run all plain-japanese checks.")
    parser.add_argument("file", nargs="?", default="-", help="file to check, or - for stdin (default)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="exit 3 when something is listed")
    args = parser.parse_args(argv)
    text = read_input(args.file)
    try:
        results = run_all(text, Path.cwd())
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({k: [asdict(f) for f in v] for k, v in results.items()}, ensure_ascii=False, indent=2))
    else:
        for title, findings in results.items():
            print_findings(title, findings, False)
    everything = [f for findings in results.values() for f in findings]
    return exit_code(everything, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
