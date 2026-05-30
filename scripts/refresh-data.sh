#!/usr/bin/env bash
# Deterministic part of the daily refresh: pull fresh OSM data, rebuild the
# published JSON, and validate it. Safe to run from cron or by the refresh agent.
# The editorial steps (classifying new facilities, re-checking curated
# megacampuses) are done by Claude — see scripts/refresh.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> [1/3] Fetching OSM data ..."
python3 pipeline/fetch.py

echo "==> [2/3] Building published data store ..."
python3 pipeline/build.py

echo "==> [3/3] Validating ..."
python3 pipeline/validate.py

echo "==> Done. New-facility worklist: data/unclassified.json"
