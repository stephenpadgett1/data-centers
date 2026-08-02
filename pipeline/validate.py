#!/usr/bin/env python3
"""Sanity-check the built data store. Exits non-zero on any failure so the daily
refresh aborts before publishing bad data (see scripts/publish-data.sh, which
gates on this)."""
from __future__ import annotations

import hashlib
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
CONFIDENCES = {"high", "medium", "low"}
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
        # confidence is rendered into the detail panel, and the editorial pass
        # that writes it reads untrusted news text — keep it to a fixed vocabulary.
        if cls.get("confidence") not in CONFIDENCES:
            errors.append(f"{tag}: bad confidence '{cls.get('confidence')}'")

        # Nothing but http(s) should ever reach an href in the site.
        for key, url in (r.get("links") or {}).items():
            if isinstance(url, str) and not url.lower().startswith(("http://", "https://")):
                errors.append(f"{tag}: non-http(s) link {key}={url[:60]!r}")

        cap = r.get("capacity_mw")
        if cap is not None and (not isinstance(cap, (int, float)) or cap < 0 or cap > 20000):
            warnings.append(f"{tag}: suspicious capacity_mw {cap}")

    # Cross-check meta totals.
    if os.path.exists(META):
        with open(META) as f:
            meta = json.load(f)
        if meta.get("total") != len(records):
            errors.append(f"meta.total {meta.get('total')} != record count {len(records)}")

        # The manifest fingerprint must describe the file sitting next to it —
        # otherwise the two halves of the data store are from different builds
        # and publish-data.sh would verify the wrong digest against the live URL.
        if meta.get("sha256"):
            with open(DATA, "rb") as f:
                actual = hashlib.sha256(f.read()).hexdigest()
            if actual != meta["sha256"]:
                errors.append(
                    f"meta.sha256 {meta['sha256'][:12]}… does not match "
                    f"data-centers.json {actual[:12]}… (stale build-meta.json?)")
        else:
            warnings.append("build-meta.json has no sha256; re-run pipeline/build.py")

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
