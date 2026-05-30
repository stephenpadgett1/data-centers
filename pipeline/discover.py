#!/usr/bin/env python3
"""Track A — announcement harvester.

Pulls RSS/Atom feeds (incl. Google News search feeds) listed in
pipeline/sources.json, keeps items that look like *new US data-center
announcements*, drops anything we've already handled or already curate, and
writes a worklist to data/discovery-candidates.json.

This is the DETERMINISTIC half. The editorial half — reading the candidates,
deciding which are real new planned campuses, extracting
{name, operator, place, MW, status} and geocoding — is done by Claude during
the daily refresh (see scripts/refresh.md). Claude then appends processed
items' keys to data/discovery-seen.json so they don't resurface.

Standard library only.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = os.path.join(HERE, "sources.json")
CURATED = os.path.join(ROOT, "data", "curated.json")
SEEN = os.path.join(ROOT, "data", "discovery-seen.json")
OUT = os.path.join(ROOT, "data", "discovery-candidates.json")

USER_AGENT = "data-centers-map/0.1 (+https://github.com/stephenpadgett1/data-centers)"
GOOGLE_NEWS = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def fetch(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except Exception as exc:  # noqa: BLE001 — feeds are flaky; skip on any error
        print(f"  ! fetch failed: {url[:70]} ({exc})")
        return None


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1]


def parse_feed(raw: bytes) -> list[dict]:
    """Parse RSS <item> or Atom <entry> into {title, link, summary, published}."""
    out: list[dict] = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return out
    for el in root.iter():
        if _strip_ns(el.tag) not in ("item", "entry"):
            continue
        rec = {"title": "", "link": "", "summary": "", "published": ""}
        for child in el:
            name = _strip_ns(child.tag)
            if name == "title":
                rec["title"] = (child.text or "").strip()
            elif name == "link":
                # RSS: text; Atom: href attribute
                rec["link"] = (child.text or child.get("href") or "").strip()
            elif name in ("description", "summary", "content"):
                rec["summary"] = re.sub(r"<[^>]+>", " ", child.text or "")[:500].strip()
            elif name in ("pubDate", "published", "updated"):
                rec["published"] = (child.text or "").strip()
        if rec["title"]:
            out.append(rec)
    return out


def norm_title(title: str) -> str:
    """Normalize for dedup: drop a trailing ' - Publisher', lowercase, alnum only."""
    t = re.split(r"\s+-\s+[^-]+$", title)[0]  # strip Google News ' - Source' suffix
    t = re.sub(r"[^a-z0-9 ]", "", t.lower())
    return re.sub(r"\s+", " ", t).strip()[:80]


def matches(text: str, keywords: list[str]) -> bool:
    low = text.lower()
    return any(k in low for k in keywords)


def curated_keys(curated: list[dict]) -> list[tuple[str, str]]:
    """(operator-token, city-token) pairs to skip campaigns we already curate."""
    pairs = []
    for c in curated:
        op = (c.get("operator") or "").lower().split("/")[0].strip().split()
        city = (c.get("city") or "").lower()
        if op and city:
            pairs.append((op[0], city))
    return pairs


def main():
    cfg = load_json(SOURCES, {})
    curated = load_json(CURATED, {"facilities": []}).get("facilities", [])
    seen = set(load_json(SEEN, {"keys": []}).get("keys", []))
    cur_pairs = curated_keys(curated)

    include = cfg.get("include_keywords", [])
    signal = cfg.get("signal_keywords", [])
    exclude = cfg.get("exclude_keywords", [])
    cap = cfg.get("max_candidates", 40)

    # Google News search feeds first — they're query-targeted + US-scoped, so
    # they carry the highest signal and should win the candidate cap.
    feed_urls = [
        ("Google News", GOOGLE_NEWS.format(q=urllib.parse.quote(q)))
        for q in cfg.get("google_news_queries", [])
    ]
    feed_urls += [(f["name"], f["url"]) for f in cfg.get("feeds", [])]

    candidates: list[dict] = []
    cand_keys: set[str] = set()
    total_items = 0

    for name, url in feed_urls:
        raw = fetch(url)
        if not raw:
            continue
        items = parse_feed(raw)
        total_items += len(items)
        for it in items:
            blob = f"{it['title']} {it['summary']}"
            if not matches(blob, include):
                continue
            if not matches(blob, signal):
                continue
            if exclude and matches(it["title"], exclude):
                continue
            key = norm_title(it["title"])
            if not key or key in seen or key in cand_keys:
                continue
            # Skip campuses we already curate (operator + city both in the title).
            low = blob.lower()
            if any(op in low and city in low for op, city in cur_pairs):
                continue
            cand_keys.add(key)
            candidates.append({
                "key": key,
                "title": it["title"],
                "source": name,
                "link": it["link"],
                "published": it["published"],
                "summary": it["summary"],
            })

    capped = len(candidates) > cap
    candidates = candidates[:cap]

    payload = {
        "generated": datetime.date.today().isoformat(),
        "count": len(candidates),
        "note": "Worklist for the editorial pass. After deciding each, append its "
                "`key` to data/discovery-seen.json so it does not resurface.",
        "candidates": candidates,
    }
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Scanned {len(feed_urls)} feeds, {total_items} items.")
    print(f"  {len(candidates)} new candidate(s) -> {os.path.relpath(OUT, ROOT)}"
          + (f" (capped from more at {cap})" if capped else ""))
    print(f"  ({len(seen)} already seen, {len(cur_pairs)} curated campuses excluded)")


if __name__ == "__main__":
    main()
