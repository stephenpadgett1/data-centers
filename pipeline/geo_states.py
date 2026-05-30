#!/usr/bin/env python3
"""US-state lookup: name<->postal, point-in-polygon assignment, and emitting a
front-end states GeoJSON with a `code` (postal) property. Standard library only.

Used by build.py to backfill `state` for facilities that lack it (OSM addr:state
is only ~half-populated) and to publish the polygon set the choropleth renders.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
STATES_GEOJSON = os.path.join(HERE, "us-states.geojson")

NAME_TO_CODE = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
    "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY", "Puerto Rico": "PR",
}
CODES = set(NAME_TO_CODE.values())


def normalize_state(raw: str | None) -> str | None:
    """Return a 2-letter code if `raw` is already a code or a known full name."""
    if not raw:
        return None
    s = raw.strip()
    if s.upper() in CODES:
        return s.upper()
    return NAME_TO_CODE.get(s.title())


def _outer_rings(geom: dict) -> list[list]:
    """Outer ring(s) as lists of [lng, lat]; holes ignored (fine for assignment)."""
    t, c = geom.get("type"), geom.get("coordinates", [])
    if t == "Polygon":
        return [c[0]] if c else []
    if t == "MultiPolygon":
        return [poly[0] for poly in c if poly]
    return []


def _point_in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


class StateLocator:
    def __init__(self, geojson_path: str = STATES_GEOJSON):
        with open(geojson_path) as f:
            data = json.load(f)
        self.states = []  # (code, (minx,miny,maxx,maxy), [rings])
        for feat in data["features"]:
            code = normalize_state(feat["properties"].get("name"))
            if not code:
                continue
            rings = _outer_rings(feat["geometry"])
            xs = [p[0] for r in rings for p in r]
            ys = [p[1] for r in rings for p in r]
            if not xs:
                continue
            self.states.append((code, (min(xs), min(ys), max(xs), max(ys)), rings))

    def locate(self, lat: float, lng: float) -> str | None:
        for code, (minx, miny, maxx, maxy), rings in self.states:
            if lng < minx or lng > maxx or lat < miny or lat > maxy:
                continue
            if any(_point_in_ring(lng, lat, r) for r in rings):
                return code
        return None


def emit_frontend_geojson(out_path: str, geojson_path: str = STATES_GEOJSON) -> int:
    """Write a copy of the states GeoJSON with a `code` (postal) property added."""
    with open(geojson_path) as f:
        data = json.load(f)
    out_feats = []
    for feat in data["features"]:
        code = normalize_state(feat["properties"].get("name"))
        if not code:
            continue
        feat["properties"] = {"code": code, "name": feat["properties"].get("name")}
        out_feats.append(feat)
    data["features"] = out_feats
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    return len(out_feats)
