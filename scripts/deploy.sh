#!/usr/bin/env bash
# Build the site and publish it to the `gh-pages` branch (the GitHub Pages
# source). Self-contained — no CI required — so the local daily job can do the
# whole pipeline: fetch -> classify -> build -> deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPO_URL="$(git remote get-url origin)"
NAME="$(git config user.name || echo 'data-centers-bot')"
EMAIL="$(git config user.email || echo 'noreply@example.com')"

echo "==> Building site (base=/data-centers/) ..."
( cd site && VITE_BASE=/data-centers/ npm run build )

echo "==> Publishing site/dist -> gh-pages ..."
cd site/dist
touch .nojekyll
git init -q
git checkout -qb gh-pages
git add -A
git -c user.name="$NAME" -c user.email="$EMAIL" commit -qm "deploy $(date +%F)"
git push -qf "$REPO_URL" gh-pages
rm -rf .git

cd "$ROOT"
echo "==> Deployed to gh-pages. Live at: https://stephenpadgett1.github.io/data-centers/"
