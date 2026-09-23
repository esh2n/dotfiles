#!/usr/bin/env python3
"""
Fetch news from sources that are blocked by Claude Code's WebFetch.
Uses only Python standard library — no pip dependencies.

Output: JSON to stdout, one object per source.
"""

import json
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

TIMEOUT = 15


def _request(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Reddit
# ---------------------------------------------------------------------------

REDDIT_SUBS = [
    "programming",
    "technology",
    "gamedev",
    "hardware",
    "worldnews",
    "business",
    "design",
]


def fetch_reddit() -> list[dict[str, Any]]:
    results = []
    for sub in REDDIT_SUBS:
        try:
            url = f"https://old.reddit.com/r/{sub}/hot/.json?limit=10"
            raw = _request(url)
            data = json.loads(raw)
            for child in data.get("data", {}).get("children", []):
                d = child.get("data", {})
                if d.get("stickied"):
                    continue
                results.append({
                    "source": f"Reddit r/{sub}",
                    "title": d.get("title", ""),
                    "url": d.get("url", ""),
                    "score": d.get("score", 0),
                    "num_comments": d.get("num_comments", 0),
                    "created_utc": d.get("created_utc", 0),
                    "selftext": (d.get("selftext", "") or "")[:300],
                })
        except Exception as e:
            results.append({
                "source": f"Reddit r/{sub}",
                "error": str(e),
            })
    return results


# ---------------------------------------------------------------------------
# NHK NEWS WEB
# ---------------------------------------------------------------------------

NHK_FEEDS = {
    "主要": "https://www.nhk.or.jp/rss/news/cat0.xml",
    "社会": "https://www.nhk.or.jp/rss/news/cat1.xml",
    "科学・文化": "https://www.nhk.or.jp/rss/news/cat3.xml",
    "政治": "https://www.nhk.or.jp/rss/news/cat4.xml",
    "経済": "https://www.nhk.or.jp/rss/news/cat5.xml",
    "国際": "https://www.nhk.or.jp/rss/news/cat6.xml",
}


def fetch_nhk() -> list[dict[str, Any]]:
    results = []
    for category, url in NHK_FEEDS.items():
        try:
            raw = _request(url)
            root = ET.fromstring(raw)
            ns = {"": "http://purl.org/rss/1.0/"}
            for item in root.findall(".//item", ns)[:5]:
                title = item.findtext("title", "", ns)
                link = item.findtext("link", "", ns)
                desc = item.findtext("description", "", ns)
                results.append({
                    "source": f"NHK {category}",
                    "title": title,
                    "url": link,
                    "description": desc,
                })
        except Exception as e:
            results.append({
                "source": f"NHK {category}",
                "error": str(e),
            })
    return results


# ---------------------------------------------------------------------------
# IGN Japan
# ---------------------------------------------------------------------------

def fetch_ign_japan() -> list[dict[str, Any]]:
    results = []
    try:
        raw = _request("https://jp.ign.com/feed.xml")
        root = ET.fromstring(raw)
        for item in root.findall(".//item")[:10]:
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            desc = item.findtext("description", "")
            results.append({
                "source": "IGN Japan",
                "title": title,
                "url": link,
                "description": (desc or "")[:300],
            })
    except Exception as e:
        results.append({"source": "IGN Japan", "error": str(e)})
    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    output = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "reddit": fetch_reddit(),
        "nhk": fetch_nhk(),
        "ign_japan": fetch_ign_japan(),
    }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
