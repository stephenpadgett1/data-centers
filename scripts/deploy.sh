#!/usr/bin/env bash
# Build the site shell and publish it to the `gh-pages` branch (the GitHub Pages
# source). Self-contained — no CI required.
#
# This publishes the SITE. The data store is refreshed independently by
# scripts/publish-data.sh, so run this only when the front-end changes; the
# daily data refresh does not need it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source scripts/lib/gh-pages.sh

echo "==> Building site (base=/data-centers/) ..."
( cd site && VITE_BASE=/data-centers/ npm run build )

# data-centers.json / build-meta.json are untracked (they live on gh-pages), so
# a clean checkout builds a dist with no data in it. Publishing that as-is would
# wipe the live data store — carry the live copies over instead.
missing=()
for f in "${DATA_FILES[@]}"; do
  [[ -f "site/dist/data/$f" ]] || missing+=("$f")
done

if (( ${#missing[@]} )); then
  echo "==> No local build for ${missing[*]}; preserving what is live ..."
  LIVE="$(mktemp -d)"
  trap 'rm -rf "$LIVE"' EXIT
  if gh_pages_fetch "$LIVE"; then
    mkdir -p site/dist/data
    for f in "${missing[@]}"; do
      if [[ -f "$LIVE/data/$f" ]]; then
        cp "$LIVE/data/$f" "site/dist/data/$f"
        echo "    carried over: $f"
      else
        echo "    WARN: $f is not on gh-pages either; site will load without it"
      fi
    done
  else
    echo "    WARN: no gh-pages branch yet; first deploy will ship without data"
    echo "    (run 'python3 pipeline/build.py && ./scripts/publish-data.sh' after)"
  fi
fi

echo "==> Publishing site/dist -> $GH_PAGES_BRANCH ..."
gh_pages_publish site/dist "deploy $(date +%F)"

echo "==> Deployed. Live at: $SITE_URL/"
