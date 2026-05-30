#!/usr/bin/env bash
# Full daily refresh + deploy cycle, invoked by launchd (or by hand).
#   sync -> fetch OSM -> Claude editorial pass -> build/validate -> commit -> deploy
# Logs to logs/refresh-<date>.log. Validation gates the publish.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# launchd runs with a minimal PATH — add the tools we need.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

mkdir -p logs
LOG="logs/refresh-$(date +%F).log"
exec >>"$LOG" 2>&1

echo "================ refresh $(date) ================"

git pull --rebase --autostash || echo "WARN: git pull failed; continuing with local state"

# 1) Deterministic data refresh (always runs; keeps last good data on fetch failure).
./scripts/refresh-data.sh || echo "WARN: refresh-data.sh reported an error"

# 2) Editorial pass via headless Claude (best-effort, time-bounded, scoped tools).
#    It edits the JSON inputs only; it does NOT push — the wrapper handles git.
timeout 1500 claude -p "$(cat scripts/refresh.md)

You are running UNATTENDED. Do steps 3, 4, and 5 of this checklist only: classify
the top ~30 recognizable facilities in data/unclassified.json into
data/classifications.json, re-check the curated megacampuses in data/curated.json,
then run pipeline/build.py and pipeline/validate.py. Do NOT run git or push — the
wrapper does that. Keep it bounded and finish promptly." \
  --permission-mode acceptEdits \
  --allowedTools "Bash(python3:*)" "Read" "Edit" "Write" "WebSearch" "Glob" "Grep" \
  || echo "WARN: Claude editorial pass skipped/failed"

# 3) Rebuild + validate (gate before publishing).
python3 pipeline/build.py || { echo "ERROR: build failed; aborting"; exit 1; }
if ! python3 pipeline/validate.py; then
  echo "ERROR: validation failed; not committing or deploying"
  exit 1
fi

# 4) Commit source-of-truth data + classifications, push to main.
git add pipeline/operators.json data/classifications.json data/curated.json \
        site/public/data/data-centers.json site/public/data/build-meta.json 2>/dev/null
if git diff --cached --quiet; then
  echo "No data changes to commit."
else
  git commit -m "data refresh $(date +%F)"
  git push origin main || echo "WARN: main push failed"
fi

# 5) Publish the site to gh-pages.
./scripts/deploy.sh || echo "WARN: deploy failed"

echo "================ done $(date) ================"
