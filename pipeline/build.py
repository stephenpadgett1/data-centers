#!/usr/bin/env python3
"""Merge normalized OSM facilities + curated megacampuses + the classification
cache into the published data store the site reads at runtime.

Outputs:
  site/public/data/data-centers.json   (array of published records)
  site/public/data/build-meta.json     (timestamp + counts for the UI)
  data/unclassified.json               (worklist for the editorial pass)
"""
from __future__ import annotations

import datetime
import json
import math
import os

import classify_rules

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

RAW = os.path.join(ROOT, "data", "facilities.raw.json")
CURATED = os.path.join(ROOT, "data", "curated.json")
CLASSIFICATIONS = os.path.join(ROOT, "data", "classifications.json")
OUT_DATA = os.path.join(ROOT, "site", "public", "data", "data-centers.json")
OUT_META = os.path.join(ROOT, "site", "public", "data", "build-meta.json")
OUT_WORKLIST = os.path.join(ROOT, "data", "unclassified.json")

TODAY = datetime.date.today().isoformat()

OPERATOR_TYPE_LABELS = {
    "hyperscaler": "hyperscale",
    "colocation": "colocation",
    "enterprise": "enterprise",
    "crypto": "crypto-mining",
    "telecom": "telecom",
    "government": "government",
    "education": "research/education",
    "unknown": "",
}
STATUS_LABELS = {
    "operational": "Operational",
    "under_construction": "Under construction",
    "planned": "Planned",
    "announced": "Announced",
    "unknown": "Status unknown",
}


def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def wikipedia_url(tag: str | None) -> str | None:
    if not tag or ":" not in tag:
        return None
    lang, article = tag.split(":", 1)
    return f"https://{lang}.wikipedia.org/wiki/{article.replace(' ', '_')}"


def osm_url(osm_type: str, osm_id: int) -> str:
    return f"https://www.openstreetmap.org/{osm_type}/{osm_id}"


def make_summary(operator, status, cls) -> str:
    """Templated fallback summary (Claude replaces these with richer ones)."""
    status_word = {
        "operational": "Operational",
        "under_construction": "Under-construction",
        "planned": "Planned",
        "announced": "Announced",
        "unknown": "",
    }.get(status, "")
    type_word = OPERATOR_TYPE_LABELS.get(cls["operator_type"], "")
    workload = cls.get("workload")
    workload_phrase = {
        "ai": "AI/accelerated-compute",
        "general": "general-compute",
        "mixed": "mixed-workload",
    }.get(workload, "")

    bits = [w for w in [status_word, workload_phrase, type_word] if w]
    head = " ".join(bits).strip() or "Data center"
    head = head[0].upper() + head[1:] + " data center"
    if operator:
        head += f" operated by {operator}"
    return head + "."


def classification_for(facility, cache):
    """cache > rules > default. Returns (classification, summary, needs_review)."""
    fid = facility["id"]
    cached = cache.get(fid)
    if cached:
        cls = {k: cached[k] for k in ("operator_type", "purpose", "workload", "confidence")}
        summary = cached.get("summary") or make_summary(facility.get("operator"), facility["status"], cls)
        return cls, summary, False

    rules = classify_rules.classify(facility)
    if rules:
        cls = {k: rules[k] for k in ("operator_type", "purpose", "workload", "confidence")}
        return cls, make_summary(facility.get("operator"), facility["status"], cls), False

    cls = {k: classify_rules.DEFAULT_CLASSIFICATION[k]
           for k in ("operator_type", "purpose", "workload", "confidence")}
    return cls, make_summary(facility.get("operator"), facility["status"], cls), True


def build_osm_record(f, cache, prev_first_seen):
    cls, summary, needs_review = classification_for(f, cache)
    links = {
        "website": f.get("website"),
        "osm": osm_url(f["osm_type"], f["osm_id"]),
        "wikidata": (f"https://www.wikidata.org/wiki/{f['wikidata']}" if f.get("wikidata")
                     else (f"https://www.wikidata.org/wiki/{f['operator_wikidata']}"
                           if f.get("operator_wikidata") else None)),
        "wikipedia": wikipedia_url(f.get("wikipedia")),
    }
    rec = {
        "id": f["id"],
        "source": "osm",
        "name": f.get("name") or "Unnamed data center",
        "operator": f.get("operator"),
        "lat": f["lat"],
        "lng": f["lng"],
        "city": f.get("city"),
        "state": f.get("state"),
        "postcode": f.get("postcode"),
        "status": f["status"],
        "capacity_mw": None,
        "area_sqft": f.get("area_sqft"),
        "minor": f.get("minor", False),
        "classification": cls,
        "summary": summary,
        "links": {k: v for k, v in links.items() if v},
        "sources": [links["osm"]],
        "first_seen": prev_first_seen.get(f["id"], TODAY),
        "last_seen": TODAY,
    }
    return rec, needs_review


def build_curated_record(c, prev_first_seen):
    cls = {
        "operator_type": c.get("operator_type", "unknown"),
        "purpose": c.get("purpose", "unknown"),
        "workload": c.get("workload", "unknown"),
        "confidence": c.get("confidence", "medium"),
    }
    links = {"website": c.get("website")}
    return {
        "id": c["id"],
        "source": "curated",
        "name": c["name"],
        "operator": c.get("operator"),
        "lat": c["lat"],
        "lng": c["lng"],
        "city": c.get("city"),
        "state": c.get("state"),
        "postcode": c.get("postcode"),
        "status": c.get("status", "announced"),
        "capacity_mw": c.get("capacity_mw"),
        "area_sqft": c.get("area_sqft"),
        "minor": False,
        "classification": cls,
        "summary": c.get("summary", ""),
        "links": {k: v for k, v in links.items() if v},
        "sources": c.get("sources", []),
        "first_seen": prev_first_seen.get(c["id"], TODAY),
        "last_seen": TODAY,
    }


def dedupe_curated_against_osm(curated_recs, osm_recs):
    """Drop an OSM record if a curated record sits within 1.2 km and shares an
    operator/name token (curated entries carry richer status/capacity)."""
    kept_osm = []
    dropped = 0
    for o in osm_recs:
        clash = False
        o_tokens = set((o.get("operator") or o["name"] or "").lower().split())
        for c in curated_recs:
            if haversine_km(o["lat"], o["lng"], c["lat"], c["lng"]) <= 1.2:
                c_tokens = set((c.get("operator") or c["name"] or "").lower().split())
                if o_tokens & c_tokens:
                    clash = True
                    break
        if clash:
            dropped += 1
        else:
            kept_osm.append(o)
    return kept_osm, dropped


def main():
    raw = load_json(RAW, {"facilities": []})
    facilities = raw.get("facilities", [])
    cache = load_json(CLASSIFICATIONS, {})
    curated = load_json(CURATED, {"facilities": []}).get("facilities", [])

    prev = load_json(OUT_DATA, [])
    prev_first_seen = {r["id"]: r.get("first_seen", TODAY) for r in prev} if isinstance(prev, list) else {}

    osm_records = []
    worklist = []
    for f in facilities:
        rec, needs_review = build_osm_record(f, cache, prev_first_seen)
        osm_records.append(rec)
        if needs_review and not rec["minor"]:
            worklist.append({
                "id": f["id"],
                "name": rec["name"],
                "operator": f.get("operator"),
                "city": f.get("city"),
                "state": f.get("state"),
                "status": f["status"],
                "area_sqft": f.get("area_sqft"),
                "website": f.get("website"),
                "osm": rec["links"].get("osm"),
            })

    curated_records = [build_curated_record(c, prev_first_seen) for c in curated]
    osm_records, dropped = dedupe_curated_against_osm(curated_records, osm_records)
    records = curated_records + osm_records
    records.sort(key=lambda r: (r["state"] or "ZZ", r["name"]))

    # ----- write outputs -----
    os.makedirs(os.path.dirname(OUT_DATA), exist_ok=True)
    with open(OUT_DATA, "w") as f:
        json.dump(records, f, ensure_ascii=False, separators=(",", ":"))

    by_status, by_type = {}, {}
    total_mw = 0
    for r in records:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        t = r["classification"]["operator_type"]
        by_type[t] = by_type.get(t, 0) + 1
        if r.get("capacity_mw"):
            total_mw += r["capacity_mw"]

    meta = {
        "built_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "refreshed_date": TODAY,
        "total": len(records),
        "from_osm": len(osm_records),
        "from_curated": len(curated_records),
        "by_status": by_status,
        "by_type": by_type,
        "total_capacity_mw": total_mw,
        "total_capacity_gw": round(total_mw / 1000, 1),
        "unclassified": len(worklist),
        "attribution": "© OpenStreetMap contributors (ODbL) · curated megacampus data from public announcements",
    }
    with open(OUT_META, "w") as f:
        json.dump(meta, f, indent=2)

    worklist.sort(key=lambda w: (-(w.get("area_sqft") or 0)))
    with open(OUT_WORKLIST, "w") as f:
        json.dump({"generated": TODAY, "count": len(worklist), "facilities": worklist},
                  f, indent=2, ensure_ascii=False)

    print(f"Built {len(records)} records "
          f"({len(osm_records)} OSM + {len(curated_records)} curated, {dropped} OSM deduped).")
    print(f"  status: {by_status}")
    print(f"  types:  {by_type}")
    print(f"  total capacity: {meta['total_capacity_gw']} GW (from {sum(1 for r in records if r['capacity_mw'])} records)")
    print(f"  unclassified worklist: {len(worklist)} -> {os.path.relpath(OUT_WORKLIST, ROOT)}")
    print(f"  wrote -> {os.path.relpath(OUT_DATA, ROOT)} ({os.path.getsize(OUT_DATA)//1024} KB)")


if __name__ == "__main__":
    main()
