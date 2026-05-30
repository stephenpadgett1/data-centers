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

   This pulls fresh OSM data, rebuilds `site/public/data/data-centers.json`,
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

5. **Rebuild + validate**

   ```bash
   python3 pipeline/build.py
   python3 pipeline/validate.py   # must exit 0 before committing
   ```

6. **Publish**

   ```bash
   git add pipeline/operators.json data/classifications.json data/curated.json \
           site/public/data/data-centers.json site/public/data/build-meta.json
   git commit -m "data refresh $(date +%F)"
   git push
   ```

   The push triggers `.github/workflows/deploy.yml`, which rebuilds and redeploys
   the site within a couple of minutes.

## Guardrails

- **Never commit if `validate.py` fails** (it exits non-zero on bad data).
- If the OSM fetch fails, `fetch.py` keeps the previous data — that's fine; the
  build still runs against the last good pull.
- Keep the per-run editorial effort bounded (top ~30 + a few curated checks) so
  daily token cost stays low. The classification cache means each facility is
  only classified once.
