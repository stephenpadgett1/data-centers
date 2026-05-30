#!/usr/bin/env python3
"""Ingest US power-generation data from EIA Form 860M into power-plants.json.

This is a SEPARATE, occasional (monthly) step — NOT part of the daily refresh.
EIA updates 860M monthly and the workbook is ~14 MB, so we fetch + parse it on
its own cadence and commit the small published JSON.

Requires openpyxl (see pipeline/requirements.txt). Everything in the daily
refresh stays pure standard library.

Output: site/public/data/power-plants.json + power-meta.json
  record: {id, name, state, county, lat, lng, mw, fuel, status, year, operator}
"""
from __future__ import annotations

import datetime
import json
import os
import sys
import urllib.request

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl required: pip install -r pipeline/requirements.txt")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "site", "public", "data", "power-plants.json")
OUT_META = os.path.join(ROOT, "site", "public", "data", "power-meta.json")

USER_AGENT = "data-centers-map/0.1 (+https://github.com/stephenpadgett1/data-centers)"
BASE_URL = "https://www.eia.gov/electricity/data/eia860m/xls/{fname}"
MIN_MW = int(os.environ.get("POWER_MIN_MW", "25"))  # operating plants below this are dropped
MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]

# Technology substring -> fuel group (first match wins).
FUEL_RULES = [
    ("natural gas", "gas"), ("coal", "coal"), ("solar", "solar"),
    ("wind", "wind"), ("nuclear", "nuclear"), ("hydro", "hydro"),
    ("batter", "battery"), ("petroleum", "petroleum"), ("oil", "petroleum"),
    ("geothermal", "geothermal"), ("wood", "biomass"), ("biomass", "biomass"),
    ("landfill", "biomass"), ("municipal", "biomass"), ("biogenic", "biomass"),
]


def fuel_of(tech: str) -> str:
    low = (tech or "").lower()
    for needle, fuel in FUEL_RULES:
        if needle in low:
            return fuel
    return "other"


def status_of_planned(code: str) -> str:
    """Planned-sheet status code -> our status. (U)/(V)/(TS) build; (P)/(L)/(T) planned."""
    c = (code or "").strip()
    tag = c[1:c.index(")")] if c.startswith("(") and ")" in c else ""
    return "under_construction" if tag in ("U", "V", "TS") else "planned"


def num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def year_of(x):
    try:
        y = int(x)
        return y if 1900 <= y <= 2100 else None
    except (TypeError, ValueError):
        return None


def download_latest() -> str:
    """Try recent months backward until a file downloads. Returns local path."""
    os.makedirs(CACHE, exist_ok=True)
    today = datetime.date.today()
    for back in range(0, 6):
        m = today.month - 1 - back
        y = today.year + (m // 12)
        m = m % 12  # 0..11
        fname = f"{MONTHS[m]}_generator{y}.xlsx"
        path = os.path.join(CACHE, fname)
        if os.path.exists(path) and os.path.getsize(path) > 100000:
            print(f"  using cached {fname}")
            return path
        url = BASE_URL.format(fname=fname)
        try:
            print(f"  trying {fname} ...")
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            if len(data) > 100000:
                with open(path, "wb") as f:
                    f.write(data)
                print(f"  downloaded {fname} ({len(data)//(1024*1024)} MB)")
                return path
        except Exception as exc:  # noqa: BLE001
            print(f"    {exc}")
    raise RuntimeError("could not download any recent EIA-860M file")


def read_sheet(wb, sheet: str):
    """Yield (row, idx) for a sheet, skipping the 2 title rows; idx maps header->col."""
    ws = wb[sheet]
    it = ws.iter_rows(values_only=True)
    next(it); next(it)
    header = next(it)
    idx = {h: i for i, h in enumerate(header) if h}
    for r in it:
        if r[idx["Plant ID"]] not in (None, "", " "):
            yield r, idx


def aggregate(wb, sheet: str, kind: str) -> dict:
    """Aggregate generators -> plants for one sheet."""
    year_col = "Operating Year" if kind == "operating" else "Planned Operation Year"
    plants: dict = {}
    for r, idx in read_sheet(wb, sheet):
        pid = r[idx["Plant ID"]]
        mw = num(r[idx["Nameplate Capacity (MW)"]])
        tech = r[idx["Technology"]] or ""
        p = plants.get(pid)
        if p is None:
            p = plants[pid] = {
                "id": f"eia/{kind}/{pid}",
                "name": r[idx["Plant Name"]],
                "state": r[idx["Plant State"]],
                "county": r[idx["County"]],
                "lat": r[idx["Latitude"]],
                "lng": r[idx["Longitude"]],
                "operator": r[idx["Entity Name"]],
                "mw": 0.0,
                "tech_mw": {},
                "status_raw": r[idx["Status"]],
                "years": [],
            }
        p["mw"] += mw
        p["tech_mw"][tech] = p["tech_mw"].get(tech, 0.0) + mw
        yr = year_of(r[idx.get(year_col)]) if year_col in idx else None
        if yr:
            p["years"].append(yr)
        if p["lat"] in (None, "", " "):
            p["lat"], p["lng"] = r[idx["Latitude"]], r[idx["Longitude"]]
    return plants


def finalize(plants: dict, kind: str) -> list:
    out = []
    for p in plants.values():
        lat, lng = num(p["lat"]), num(p["lng"])
        if not lat or not lng:
            continue
        if kind == "operating" and p["mw"] < MIN_MW:
            continue
        dominant = max(p["tech_mw"].items(), key=lambda kv: kv[1])[0] if p["tech_mw"] else ""
        status = "operational" if kind == "operating" else status_of_planned(p["status_raw"])
        out.append({
            "id": p["id"],
            "name": p["name"] or "Unnamed plant",
            "state": p["state"],
            "county": p["county"],
            "lat": round(lat, 5),
            "lng": round(lng, 5),
            "mw": round(p["mw"], 1),
            "fuel": fuel_of(dominant),
            "status": status,
            "year": min(p["years"]) if p["years"] else None,
            "operator": p["operator"],
        })
    return out


def main() -> int:
    print(f"Fetching EIA-860M (MIN_MW={MIN_MW}) ...")
    try:
        path = download_latest()
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print("Parsing workbook ...")
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    operating = finalize(aggregate(wb, "Operating", "operating"), "operating")
    planned = finalize(aggregate(wb, "Planned", "planned"), "planned")
    records = operating + planned
    records.sort(key=lambda r: -r["mw"])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(records, f, ensure_ascii=False, separators=(",", ":"))

    by_status, by_fuel, gw_by_fuel = {}, {}, {}
    for r in records:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        by_fuel[r["fuel"]] = by_fuel.get(r["fuel"], 0) + 1
        gw_by_fuel[r["fuel"]] = round(gw_by_fuel.get(r["fuel"], 0) + r["mw"] / 1000, 1)
    meta = {
        "built_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": f"U.S. EIA Form 860M ({os.path.basename(path)})",
        "min_mw": MIN_MW,
        "total_plants": len(records),
        "by_status": by_status,
        "by_fuel": by_fuel,
        "gw_by_fuel": gw_by_fuel,
        "total_gw": round(sum(r["mw"] for r in records) / 1000, 1),
        "operating_gw": round(sum(r["mw"] for r in records if r["status"] == "operational") / 1000, 1),
        "pipeline_gw": round(sum(r["mw"] for r in records if r["status"] != "operational") / 1000, 1),
    }
    with open(OUT_META, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"Wrote {len(records)} plants "
          f"({by_status.get('operational',0)} operational, "
          f"{by_status.get('under_construction',0)} UC, {by_status.get('planned',0)} planned).")
    print(f"  operating {meta['operating_gw']} GW | pipeline {meta['pipeline_gw']} GW")
    print(f"  fuels: {by_fuel}")
    print(f"  -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)//1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
