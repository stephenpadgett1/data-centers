# US Data Centers Map

An interactive dark map of US data centers — **operational, under construction, and planned** — with editorial judgment calls on each facility (purpose-built vs speculative, AI vs general compute, operator type).

Live data is pulled from OpenStreetMap and a curated layer of headline announced AI megacampuses, classified by Claude, and published as a static JSON the site reads at runtime. The whole thing is refreshed daily.

## How it works

```
OSM Overpass API ──fetch.py──▶ data/facilities.raw.json ─┐
news + trade RSS ──discover.py─▶ candidates ─(Claude)─┐  │
data/curated.json (curated + discovered campuses) ────┼──┤
data/classifications.json (editorial cache) ──────────┼──┼─build.py─▶ site/public/data/data-centers.json
pipeline/operators.json (operator lookup) ────────────┘  ┘                + build-meta.json
                                                                          + data/unclassified.json (worklist)
```

**Data sources for *planned* facilities** (the hardest part — OSM barely maps them):
- `pipeline/discover.py` harvests Google News search feeds + trade press
  (DataCenterDynamics, DataCenterKnowledge, Bisnow, Data Center POST), filters to
  likely new US announcements, and writes a candidate worklist.
- During the daily refresh, Claude reads the candidates, keeps the genuine new
  projects, geocodes them (`pipeline/geocode.py`, OSM Nominatim), and adds them to
  `data/curated.json` — typically `status: planned`, `purpose: speculative`.
- Feed URLs live in `pipeline/sources.json` (brittle by nature — re-verify if a
  feed goes quiet).

- **No backend, no database.** The "data store" is `site/public/data/data-centers.json`, committed to the repo.
- **Front-end:** Vite + TypeScript + MapLibre GL JS, OpenFreeMap dark basemap (no API key).
- **Hosting:** GitHub Pages, served from the `gh-pages` branch. `scripts/deploy.sh`
  builds the site and publishes it there — fully self-contained, no CI required.
  (`docs/deploy-actions.yml.example` is an alternative GitHub Actions workflow if
  you prefer CI deploys; it needs a token with `workflow` scope.)

## Local development

```bash
# 1. Pull + build the data (Python stdlib only, no pip install)
python3 pipeline/fetch.py        # pull OSM Overpass -> data/facilities.raw.json
python3 pipeline/build.py        # merge -> site/public/data/data-centers.json
python3 pipeline/validate.py     # sanity-check the output

# 2. Run the site
cd site
npm install
npm run dev                      # http://localhost:5173
```

## Daily refresh

The refresh runs through Claude Code (see `scripts/refresh.md` for the exact checklist).
It pulls fresh OSM data, classifies any newly-seen facilities, re-checks the curated
megacampuses, rebuilds the JSON, commits the data, and republishes the site.

A `launchd` job (`scripts/refresh-cron.sh`) runs this daily on the local machine:

```bash
./scripts/refresh-cron.sh        # one full refresh + deploy cycle
```

Manual deploy any time:

```bash
./scripts/deploy.sh              # build + publish to gh-pages
```

## Data & attribution

- Facility locations: © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
- Basemap: [OpenFreeMap](https://openfreemap.org/) © OpenMapTiles.
- Status, capacity, and classifications are editorial estimates generated from public
  sources; treat them as informed approximations, not authoritative records.
