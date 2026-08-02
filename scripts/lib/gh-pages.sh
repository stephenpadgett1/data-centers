#!/usr/bin/env bash
# Shared gh-pages plumbing for deploy.sh (site shell) and publish-data.sh (data
# store). Both publish to the same branch but own different parts of the tree,
# so both go through fetch -> overlay -> publish and neither clobbers the other.
#
# Source this AFTER cd'ing to the repo root.

GH_PAGES_BRANCH="gh-pages"

# The published data store: built by pipeline/build.py, served from gh-pages,
# and deliberately NOT tracked in this repo (see .gitignore). Anything listed
# here is owned by publish-data.sh; deploy.sh preserves it.
DATA_FILES=(data-centers.json build-meta.json)

# Overridable so a fork (or a dry run against a scratch bare repo) can retarget
# the publish without editing these scripts.
REPO_URL="${REPO_URL:-$(git remote get-url origin)}"
GIT_NAME="$(git config user.name || echo 'data-centers-bot')"
GIT_EMAIL="$(git config user.email || echo 'noreply@example.com')"

# https://github.com/OWNER/REPO.git (or git@github.com:OWNER/REPO.git)
#   -> https://OWNER.github.io/REPO
_slug="${REPO_URL%.git}"
_repo="${_slug##*/}"
_rest="${_slug%/*}"
_owner="${_rest##*[:/]}"
SITE_URL="${SITE_URL:-https://${_owner}.github.io/${_repo}}"

# sha256 of stdin, as a bare hex digest. sha256sum on Linux, shasum on macOS.
sha256_of() {
  local out
  if command -v sha256sum >/dev/null 2>&1; then
    out="$(sha256sum)"
  else
    out="$(shasum -a 256)"
  fi
  printf '%s\n' "${out%% *}"
}

# gh_pages_fetch <dest-dir>
# Populate <dest-dir> with the current live gh-pages tree (no .git). Returns 1
# if the branch does not exist yet, so callers can fall back to a first deploy.
gh_pages_fetch() {
  local dest="$1"
  if ! git ls-remote --exit-code --heads "$REPO_URL" "$GH_PAGES_BRANCH" >/dev/null 2>&1; then
    return 1
  fi
  mkdir -p "$dest"
  git clone -q --depth 1 --branch "$GH_PAGES_BRANCH" --single-branch "$REPO_URL" "$dest"
  rm -rf "${dest:?}/.git"
}

# gh_pages_publish <src-dir> <commit-message>
# Force-push <src-dir> as a single orphan commit. gh-pages is a build artifact,
# so it is rewritten rather than appended to — that is what keeps a 1.4 MB
# daily payload from accumulating any history at all.
gh_pages_publish() {
  local src="$1" msg="$2"
  (
    cd "$src"
    touch .nojekyll
    rm -rf .git
    git init -q
    git checkout -qb "$GH_PAGES_BRANCH"
    git add -A
    git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" commit -qm "$msg"
    git push -qf "$REPO_URL" "$GH_PAGES_BRANCH"
    rm -rf .git
  )
}

# gh_pages_verify <path-under-site> <expected-sha256>
# Confirm the live URL actually serves the bytes we just pushed. Uses a
# cache-busting query so we read through the Pages CDN edge, and polls because
# a Pages build lags the push by anywhere from seconds to a couple of minutes.
gh_pages_verify() {
  local path="$1" want="$2"
  local tries="${3:-${VERIFY_TRIES:-10}}" delay="${4:-${VERIFY_DELAY:-10}}"
  local url="$SITE_URL/$path" got i=0
  while (( i < tries )); do
    got="$(curl -fsSL --max-time 60 "$url?cb=$$-$i" 2>/dev/null | sha256_of)" || got=""
    if [[ "$got" == "$want" ]]; then
      echo "    live: $path  sha256 ${want:0:12}…"
      return 0
    fi
    i=$((i + 1))
    # `if` rather than `(( )) && sleep`: the latter returns non-zero on the last
    # iteration, which would trip `set -e` in any caller that doesn't use `||`.
    if (( i < tries )); then sleep "$delay"; fi
  done
  if [[ -z "$got" ]]; then
    echo "    WARN: $path not reachable at $url after $((tries * delay))s"
  else
    echo "    WARN: $path still serving ${got:0:12}… (want ${want:0:12}…) after $((tries * delay))s"
  fi
  return 1
}
