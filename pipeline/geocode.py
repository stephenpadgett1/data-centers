#!/usr/bin/env python3
"""Geocode a place string ('City, ST', 'Rapides Parish, LA', ...) to lat/lng via
OpenStreetMap Nominatim, with an on-disk cache so we never repeat a lookup.

Used by the editorial pass to place discovered campuses accurately instead of
guessing coordinates. Nominatim usage policy: <= 1 req/sec, real User-Agent,
cache results — all honored here.

  python3 pipeline/geocode.py "Rapides Parish, LA"      -> prints "31.19,-92.53"
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "data", "geocode-cache.json")
ENDPOINT = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "data-centers-map/0.1 (+https://github.com/stephenpadgett1/data-centers)"

_last_call = [0.0]


def _load_cache() -> dict:
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            return json.load(f)
    return {}


def _save_cache(cache: dict) -> None:
    with open(CACHE, "w") as f:
        json.dump(cache, f, indent=2, sort_keys=True)


def _throttle() -> None:
    elapsed = time.time() - _last_call[0]
    if elapsed < 1.1:
        time.sleep(1.1 - elapsed)
    _last_call[0] = time.time()


def geocode(place: str, country: str = "us") -> dict | None:
    """Return {"lat": float, "lng": float} or None. Cached (incl. negative)."""
    key = " ".join(place.strip().lower().split())
    if not key:
        return None
    cache = _load_cache()
    if key in cache:
        return cache[key]

    _throttle()
    params = urllib.parse.urlencode({
        "q": place, "format": "json", "limit": 1, "countrycodes": country,
    })
    result = None
    try:
        req = urllib.request.Request(f"{ENDPOINT}?{params}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data:
            result = {"lat": round(float(data[0]["lat"]), 5), "lng": round(float(data[0]["lon"]), 5)}
    except Exception as exc:  # noqa: BLE001
        print(f"geocode error for {place!r}: {exc}", file=sys.stderr)
        return None  # don't cache transient failures

    cache[key] = result
    _save_cache(cache)
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: geocode.py \"City, ST\"", file=sys.stderr)
        raise SystemExit(2)
    res = geocode(" ".join(sys.argv[1:]))
    if res:
        print(f"{res['lat']},{res['lng']}")
    else:
        print("not found", file=sys.stderr)
        raise SystemExit(1)
