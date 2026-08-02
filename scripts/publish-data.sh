#!/usr/bin/env bash
# Publish ONLY the built data store to gh-pages — no site rebuild, no commit on
# main. The site fetches these files same-origin at runtime, so this is the
# whole data-refresh publish step.
#
#   pipeline/build.py -> site/public/data/*.json -> gh-pages:/data/*.json
#                                                -> https://<user>.github.io/<repo>/data/
#
# Validation gates the push, and the push is verified against the live URL
# afterwards, so a half-written or invalid payload never becomes the live data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source scripts/lib/gh-pages.sh

SRC="site/public/data"

echo "==> [1/4] Validating built data ..."
python3 pipeline/validate.py

for f in "${DATA_FILES[@]}"; do
  if [[ ! -f "$SRC/$f" ]]; then
    echo "ERROR: $SRC/$f missing — run 'python3 pipeline/build.py' first" >&2
    exit 1
  fi
done

echo "==> [2/4] Fetching live gh-pages tree ..."
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
if ! gh_pages_fetch "$STAGE"; then
  echo "ERROR: no gh-pages branch yet — run ./scripts/deploy.sh once to publish the site" >&2
  exit 1
fi
if [[ ! -f "$STAGE/index.html" ]]; then
  echo "ERROR: gh-pages has no index.html; refusing to publish data over a broken site" >&2
  exit 1
fi

echo "==> [3/4] Overlaying data + publishing ..."
mkdir -p "$STAGE/data"
for f in "${DATA_FILES[@]}"; do
  cp "$SRC/$f" "$STAGE/data/$f"
  echo "    $f  ($(( $(wc -c <"$SRC/$f") / 1024 )) KB)"
done
gh_pages_publish "$STAGE" "data $(date +%F)"

echo "==> [4/4] Verifying live payload ..."
rc=0
for f in "${DATA_FILES[@]}"; do
  gh_pages_verify "data/$f" "$(sha256_of <"$SRC/$f")" || rc=1
done

if (( rc != 0 )); then
  echo "==> Pushed, but not confirmed live yet. GitHub Pages builds asynchronously;"
  echo "    re-check: curl -s $SITE_URL/data/build-meta.json | head -c 200"
else
  echo "==> Data store published: $SITE_URL/data/"
fi
