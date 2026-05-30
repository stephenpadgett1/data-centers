#!/usr/bin/env python3
"""Pull US data-center features from the OpenStreetMap Overpass API and
normalize them into data/facilities.raw.json.

Standard library only (no pip install) so the daily refresh agent needs no setup.

Output record shape (normalized OSM feature):
    {
      "id": "osm/way/123",
      "osm_type": "way", "osm_id": 123,
      "name": "...", "operator": "...",
      "lat": 38.9, "lng": -77.0,
      "city": "...", "state": "VA", "postcode": "...",
      "status": "operational|under_construction|planned",
      "area_sqft": 120000 | None,
      "minor": false,
      "website": "...", "operator_wikidata": "...",
      "wikidata": "...", "wikipedia": "...",
      "raw_tags": { ... }            # kept for the classifier / debugging
    }
"""
from __future__ import annotations

import datetime
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW_DIR = os.path.join(ROOT, "data", "raw")
OUT_PATH = os.path.join(ROOT, "data", "facilities.raw.json")

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "data-centers-map/0.1 (+https://github.com/; daily refresh)"

# One query, whole-US area. `out tags geom` gives us tags plus full geometry
# for ways (so we can derive a centroid and an approximate footprint area).
OVERPASS_QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="US"][admin_level=2]->.usa;
(
  nwr["telecom"="data_center"](area.usa);
  nwr["building"="data_center"](area.usa);
  nwr["industrial"="data_center"](area.usa);
  nwr["construction"="data_center"](area.usa);
  nwr["construction:telecom"="data_center"](area.usa);
  nwr["proposed:telecom"="data_center"](area.usa);
);
out tags geom;
"""

# Name keywords that signal a small internal / non-commercial room rather than a
# real facility. Flagged as `minor` (filterable in the UI), not dropped.
MINOR_NAME_HINTS = (
    "computer room", "server room", "server closet", "data closet",
    "machine room", "mdf", "idf", "telecom room", "comms room",
    "computation", "computing center", "hpc", "supercomput",
)


def http_post(endpoint: str, query: str, timeout: int = 200) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        endpoint, data=data, headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_overpass() -> dict:
    """Try each endpoint with one retry + backoff. Raise if all fail."""
    last_err: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(2):
            try:
                print(f"  querying {endpoint} (attempt {attempt + 1}) ...")
                return http_post(endpoint, OVERPASS_QUERY)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                last_err = exc
                print(f"    failed: {exc}")
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"all Overpass endpoints failed: {last_err}")


# ---------- geometry helpers ----------

EARTH_R = 6378137.0  # WGS84 equatorial radius, meters
SQM_TO_SQFT = 10.76391041671


def _polygon_centroid_and_area(coords: list[tuple[float, float]]):
    """coords: list of (lat, lon). Returns (lat, lng, area_sqft|None).

    Uses an equirectangular projection around the mean latitude, then the
    shoelace formula. Good enough for marker placement + footprint estimate.
    """
    pts = [(c[0], c[1]) for c in coords if c[0] is not None and c[1] is not None]
    if not pts:
        return None, None, None
    # Drop a duplicated closing vertex if present.
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) == 1:
        return pts[0][0], pts[0][1], None

    lat0 = sum(p[0] for p in pts) / len(pts)
    cos_lat0 = math.cos(math.radians(lat0))

    def project(lat, lon):
        x = math.radians(lon) * EARTH_R * cos_lat0
        y = math.radians(lat) * EARTH_R
        return x, y

    xy = [project(lat, lon) for lat, lon in pts]
    n = len(xy)
    if n < 3:
        clat = sum(p[0] for p in pts) / n
        clon = sum(p[1] for p in pts) / n
        return clat, clon, None

    area2 = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n):
        x0, y0 = xy[i]
        x1, y1 = xy[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        area2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross

    if abs(area2) < 1e-9:
        clat = sum(p[0] for p in pts) / n
        clon = sum(p[1] for p in pts) / n
        return clat, clon, None

    area_m2 = abs(area2) / 2.0
    cx /= 3.0 * area2
    cy /= 3.0 * area2
    # Unproject centroid back to lat/lon.
    clon = math.degrees(cx / (EARTH_R * cos_lat0))
    clat = math.degrees(cy / EARTH_R)
    return clat, clon, round(area_m2 * SQM_TO_SQFT)


def element_centroid_area(el: dict):
    etype = el.get("type")
    if etype == "node":
        return el.get("lat"), el.get("lon"), None
    if etype == "way":
        geom = el.get("geometry") or []
        coords = [(g["lat"], g["lon"]) for g in geom if "lat" in g and "lon" in g]
        if coords:
            return _polygon_centroid_and_area(coords)
        # fall back to bounds center
        b = el.get("bounds")
        if b:
            return (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2, None
        return None, None, None
    if etype == "relation":
        # Average all member geometry coordinates for a rough centroid.
        lats, lons = [], []
        for m in el.get("members", []):
            for g in m.get("geometry", []) or []:
                if "lat" in g and "lon" in g:
                    lats.append(g["lat"])
                    lons.append(g["lon"])
        if lats:
            return sum(lats) / len(lats), sum(lons) / len(lons), None
        b = el.get("bounds")
        if b:
            return (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2, None
    return None, None, None


# ---------- normalization ----------

def derive_status(tags: dict) -> str:
    if tags.get("construction") == "data_center" or tags.get("construction:telecom") == "data_center":
        return "under_construction"
    if "proposed:telecom" in tags or tags.get("proposed") == "data_center":
        return "planned"
    if tags.get("building") == "construction":
        return "under_construction"
    return "operational"


def is_minor(tags: dict, name: str, operator: str, etype: str, area_sqft) -> bool:
    low = (name or "").lower()
    if any(h in low for h in MINOR_NAME_HINTS):
        return True
    # An unnamed/operator-less point with no web presence is almost always noise.
    if etype == "node" and not operator and not tags.get("website") and not tags.get("addr:city"):
        return True
    # University / research operators are typically internal rooms.
    if operator and any(k in operator.lower() for k in ("university", "college", "school district")):
        return True
    return False


def normalize(el: dict) -> dict | None:
    tags = el.get("tags") or {}
    etype = el.get("type")
    oid = el.get("id")
    lat, lng, area_sqft = element_centroid_area(el)
    if lat is None or lng is None:
        return None

    name = tags.get("name") or tags.get("short_name") or tags.get("addr:housename")
    operator = tags.get("operator") or tags.get("owner")

    return {
        "id": f"osm/{etype}/{oid}",
        "osm_type": etype,
        "osm_id": oid,
        "name": name,
        "operator": operator,
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "city": tags.get("addr:city"),
        "state": tags.get("addr:state"),
        "postcode": tags.get("addr:postcode"),
        "status": derive_status(tags),
        "area_sqft": area_sqft,
        "minor": is_minor(tags, name, operator, etype, area_sqft),
        "website": tags.get("website") or tags.get("contact:website"),
        "operator_wikidata": tags.get("operator:wikidata"),
        "wikidata": tags.get("wikidata"),
        "wikipedia": tags.get("wikipedia"),
        "raw_tags": tags,
    }


def main() -> int:
    os.makedirs(RAW_DIR, exist_ok=True)
    print("Fetching US data centers from Overpass ...")
    try:
        raw = fetch_overpass()
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        if os.path.exists(OUT_PATH):
            print("Keeping existing data/facilities.raw.json (fetch failed).")
            return 0
        return 1

    today = datetime.date.today().isoformat()
    raw_path = os.path.join(RAW_DIR, f"osm-{today}.json")
    with open(raw_path, "w") as f:
        json.dump(raw, f)
    print(f"  wrote raw -> {os.path.relpath(raw_path, ROOT)}")

    elements = raw.get("elements", [])
    facilities = []
    skipped = 0
    for el in elements:
        rec = normalize(el)
        if rec is None:
            skipped += 1
            continue
        facilities.append(rec)

    facilities.sort(key=lambda r: (r["state"] or "ZZ", r["name"] or "zzz"))

    payload = {
        "fetched_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "count": len(facilities),
        "facilities": facilities,
    }
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    minor = sum(1 for r in facilities if r["minor"])
    with_op = sum(1 for r in facilities if r["operator"])
    with_area = sum(1 for r in facilities if r["area_sqft"])
    print(
        f"Normalized {len(facilities)} facilities "
        f"({skipped} skipped, no coords) -> {os.path.relpath(OUT_PATH, ROOT)}"
    )
    print(f"  with operator: {with_op} | with area: {with_area} | minor: {minor}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
