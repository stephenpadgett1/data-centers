#!/usr/bin/env python3
"""Sanity-check the published data store. Exits non-zero on any failure so the
daily refresh agent can abort before committing bad data."""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "site", "public", "data", "data-centers.json")
META = os.path.join(ROOT, "site", "public", "data", "build-meta.json")

STATUSES = {"operational", "under_construction", "planned", "announced", "unknown"}
TYPES = {"hyperscaler", "colocation", "enterprise", "crypto", "telecom",
         "government", "education", "unknown"}
PURPOSES = {"purpose_built", "speculative", "multi_tenant", "unknown"}
WORKLOADS = {"ai", "general", "mixed", "unknown"}
# Generous continental + AK/HI/territories bounding box.
LAT_RANGE = (15.0, 72.0)
LNG_RANGE = (-180.0, -64.0)


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    if not os.path.exists(DATA):
        print(f"FAIL: {DATA} does not exist", file=sys.stderr)
        return 1

    with open(DATA) as f:
        records = json.load(f)

    if not isinstance(records, list) or not records:
        print("FAIL: data-centers.json is empty or not a list", file=sys.stderr)
        return 1

    if len(records) < 500:
        warnings.append(f"only {len(records)} records (expected ~1500+); did the fetch shrink?")

    seen_ids = set()
    for i, r in enumerate(records):
        tag = r.get("id", f"index {i}")
        if r.get("id") in seen_ids:
            errors.append(f"duplicate id: {r.get('id')}")
        seen_ids.add(r.get("id"))

        for key in ("id", "name", "lat", "lng", "status", "classification", "summary"):
            if key not in r:
                errors.append(f"{tag}: missing '{key}'")

        lat, lng = r.get("lat"), r.get("lng")
        if not isinstance(lat, (int, float)) or not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            errors.append(f"{tag}: lat out of range: {lat}")
        if not isinstance(lng, (int, float)) or not (LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
            errors.append(f"{tag}: lng out of range: {lng}")

        if r.get("status") not in STATUSES:
            errors.append(f"{tag}: bad status '{r.get('status')}'")

        cls = r.get("classification", {})
        if cls.get("operator_type") not in TYPES:
            errors.append(f"{tag}: bad operator_type '{cls.get('operator_type')}'")
        if cls.get("purpose") not in PURPOSES:
            errors.append(f"{tag}: bad purpose '{cls.get('purpose')}'")
        if cls.get("workload") not in WORKLOADS:
            errors.append(f"{tag}: bad workload '{cls.get('workload')}'")

        cap = r.get("capacity_mw")
        if cap is not None and (not isinstance(cap, (int, float)) or cap < 0 or cap > 20000):
            warnings.append(f"{tag}: suspicious capacity_mw {cap}")

    # Cross-check meta totals.
    if os.path.exists(META):
        with open(META) as f:
            meta = json.load(f)
        if meta.get("total") != len(records):
            errors.append(f"meta.total {meta.get('total')} != record count {len(records)}")

    for w in warnings:
        print(f"WARN: {w}")
    if errors:
        for e in errors[:40]:
            print(f"FAIL: {e}", file=sys.stderr)
        if len(errors) > 40:
            print(f"... and {len(errors) - 40} more", file=sys.stderr)
        print(f"\n{len(errors)} validation error(s).", file=sys.stderr)
        return 1

    print(f"OK: {len(records)} records valid"
          f"{f', {len(warnings)} warning(s)' if warnings else ''}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
