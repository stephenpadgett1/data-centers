# Daily refresh checklist (for the scheduled Claude Code agent)

This is the prompt/checklist the daily scheduled agent follows. It keeps both the
facility data and the editorial judgment calls fresh, then publishes by pushing to
`main` (which triggers the GitHub Pages deploy).

## Steps

1. **Sync the repo**

   ```bash
   cd <repo>
   git pull --rebase
   ```

2. **Refresh the data (deterministic)**

   ```bash
   ./scripts/refresh-data.sh
   ```

   This pulls fresh OSM data, **harvests announcement feeds** (writing
   `data/discovery-candidates.json`), rebuilds `site/public/data/data-centers.json`,
   validates it, and writes the new-facility worklist `data/unclassified.json`.

3. **Editorial pass — classify new facilities** (this is the Claude-in-the-loop value)

   - Open `data/unclassified.json` (sorted by footprint, biggest first).
   - For the **top ~30 entries** that are recognizable (named operator or a
     well-known facility), add an entry to `data/classifications.json` keyed by
     the facility `id`, with: `operator_type`, `purpose`, `workload`,
     `confidence`, a 1–2 sentence `summary`, `"source": "claude"`, and
     `"classified_on": "<today>"`. See existing entries for the shape.
   - If an operator recurs across many facilities, prefer adding it to
     `pipeline/operators.json` instead — that classifies all of them at once and
     is cheaper than per-facility entries.
   - Leave genuinely ambiguous / unnamed facilities unclassified; they stay
     "unknown" (filterable in the UI) and can be picked up on a future run.
     The long tail fills in over days — do not try to classify all 400+ at once.

4. **Editorial pass — refresh the curated megacampuses**

   - Open `data/curated.json`. For a few of the headline campuses, do a quick
     WebSearch to check whether `status` (planned → under_construction →
     operational) or `capacity_mw` has changed; update if so.
   - Add any newly-announced megacampus (≥ ~500 MW, well-sourced) that OSM
     doesn't capture, following the existing entry shape (include `sources`).

5. **Editorial pass — process announcement candidates (Track A)**

   - Open `data/discovery-candidates.json` (harvested planned/proposed projects
     from news + trade feeds).
   - For each candidate that is a **genuine, new, US data-center project** (not a
     duplicate of something already in `curated.json`, not a withdrawn/denied/
     cancelled project, not a market report or opinion piece), add an entry to
     `data/curated.json` `facilities` with the usual shape. Typical values for a
     fresh proposal: `"status": "planned"`, `"operator_type": "unknown"` (unless a
     known operator is named), `"purpose": "speculative"`, `workload` `ai` or
     `general`, `"confidence": "low"`, `sources: [<candidate link>]`.
   - **Geocode the location** instead of guessing coordinates:

     ```bash
     python3 pipeline/geocode.py "City, ST"      # prints "lat,lng"
     ```

   - After deciding every candidate (kept OR rejected), append each candidate's
     `key` to `data/discovery-seen.json` so it never resurfaces. Bound the effort
     to the worklist you were given.

6. **Rebuild + validate**

   ```bash
   python3 pipeline/build.py
   python3 pipeline/validate.py   # must exit 0 before committing
   ```

7. **Publish**

   ```bash
   git add pipeline/operators.json data/classifications.json data/curated.json \
           data/discovery-seen.json data/geocode-cache.json \
           site/public/data/data-centers.json site/public/data/build-meta.json
   git commit -m "data refresh $(date +%F)"
   git push origin main
   ./scripts/deploy.sh            # build + publish to gh-pages
   ```

## Guardrails

- **Never commit if `validate.py` fails** (it exits non-zero on bad data).
- If the OSM fetch fails, `fetch.py` keeps the previous data — that's fine; the
  build still runs against the last good pull.
- Keep per-run editorial effort bounded (top ~30 unclassified + the announcement
  worklist + a few curated re-checks) so daily token cost stays low. The
  classification + seen caches mean each item is only handled once.
- Discovered proposals are often early-stage and contested — keep their
  `confidence` low and prefer `purpose: speculative` until a project firms up.
- The **power-generation layer** (`site/public/data/power-plants.json`, EIA Form
  860M) is **not** part of this daily run. Refresh it ~monthly on its own:
  `pip install -r pipeline/requirements.txt && python3 pipeline/fetch_power.py`,
  then rebuild/commit. (Keeps the daily refresh dependency-free.)
