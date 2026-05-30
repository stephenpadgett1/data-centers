#!/usr/bin/env python3
"""Deterministic, high-confidence classification from the operator lookup table
plus a few keyword heuristics. Returns None when there is no confident call, so
the facility is deferred to Claude (the editorial pass) instead of being guessed.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_OPERATORS_PATH = os.path.join(HERE, "operators.json")

with open(_OPERATORS_PATH) as _f:
    _OPERATORS = json.load(_f)["operators"]

# Keyword heuristics applied to operator + name when no operator-table match.
_CRYPTO_HINTS = ("bitcoin", "blockchain", "mining", "hashrate", "miner", "btc ")
_GOV_HINTS = (
    "national lab", "naval", "air force", "u.s. army", "us army", "nasa",
    "department of", "dept of", "federal", "county of", "state of",
    "city of", ".gov", "national laboratory", "sandia", "los alamos",
    "oak ridge", "lawrence livermore", "argonne",
)
_EDU_HINTS = ("university", "college", "institute of technology", "school district")
_AI_HINTS = ("ai ", " ai", "gpu", "artificial intelligence", "supercomput", "colossus")
# Financial institutions / large corporates running their own facilities.
_FINANCE_HINTS = (
    "bank", "barclays", "jpmorgan", "jp morgan", "capital one", "bloomberg",
    "nyse", "stock exchange", "insurance", "travelers", "fidelity",
    "goldman", "morgan stanley", "wells fargo", "bnym", "mellon",
)


def _match_operator(value: str) -> dict | None:
    low = value.lower()
    for entry in _OPERATORS:
        for alias in entry["aliases"]:
            if alias in low:
                return entry
    return None


def classify(facility: dict) -> dict | None:
    """Return a classification dict or None (defer to Claude).

    dict shape: {operator_type, purpose, workload, confidence, source}
    """
    operator = (facility.get("operator") or "").strip()
    name = (facility.get("name") or "").strip()
    blob = f"{operator} {name}".lower()

    # 1) Known operator -> high confidence. Fall back to matching the brand in
    #    the facility name when the operator tag is missing (slightly lower conf).
    entry = _match_operator(operator) if operator else None
    matched_via_name = False
    if not entry and name:
        entry = _match_operator(name)
        matched_via_name = entry is not None
    if entry:
        workload = entry["workload"]
        # Nudge a hyperscaler toward AI if the name itself screams it.
        if entry["operator_type"] == "hyperscaler" and any(h in blob for h in _AI_HINTS):
            workload = "ai"
        return {
            "operator_type": entry["operator_type"],
            "purpose": entry["purpose"],
            "workload": workload,
            "confidence": "medium" if matched_via_name else "high",
            "source": "rules",
        }

    # 2) Keyword heuristics (work even without a named operator).
    if any(h in blob for h in _FINANCE_HINTS):
        return {"operator_type": "enterprise", "purpose": "purpose_built",
                "workload": "general", "confidence": "medium", "source": "rules"}
    if any(h in blob for h in _CRYPTO_HINTS):
        return {"operator_type": "crypto", "purpose": "purpose_built",
                "workload": "general", "confidence": "medium", "source": "rules"}
    if any(h in blob for h in _GOV_HINTS):
        return {"operator_type": "government", "purpose": "purpose_built",
                "workload": "general", "confidence": "medium", "source": "rules"}
    if any(h in blob for h in _EDU_HINTS):
        return {"operator_type": "education", "purpose": "purpose_built",
                "workload": "general", "confidence": "medium", "source": "rules"}

    # 3) No confident call -> defer to Claude.
    return None


DEFAULT_CLASSIFICATION = {
    "operator_type": "unknown",
    "purpose": "unknown",
    "workload": "unknown",
    "confidence": "low",
    "source": "default",
}
