"""The evaluation fixtures keep the shape references/evaluation-plan.md describes."""

from collections import Counter
from pathlib import Path

ITEMS = Path(__file__).resolve().parent.parent / "evals" / "items"
REQUIRED = ("id", "category", "reader", "task", "traps", "must_keep")


def front_matter(path: Path) -> tuple[dict[str, str], list[str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "---", path
    end = lines.index("---", 1)
    meta = dict(line.split(": ", 1) for line in lines[1:end])
    facts = [line for line in lines[end + 1 :] if line[:1].isdigit()]
    return meta, facts


def test_eighteen_items_in_the_planned_mix():
    paths = sorted(ITEMS.glob("*.md"))
    assert len(paths) == 18
    categories = Counter(front_matter(p)[0]["category"] for p in paths)
    assert categories == {"ja-doc": 6, "ja-chat": 6, "ja-memo": 3, "en": 3}


def test_every_item_has_its_fields_and_numbered_facts():
    for path in sorted(ITEMS.glob("*.md")):
        meta, facts = front_matter(path)
        assert all(key in meta for key in REQUIRED), path
        assert path.name.startswith(meta["id"].strip('"')), path
        assert len(facts) >= 5, path
        assert [int(f.split(".", 1)[0]) for f in facts] == list(range(1, len(facts) + 1)), path
