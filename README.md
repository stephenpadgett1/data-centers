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

**Power-generation layer (EIA Form 860M):** a toggleable second layer of ~6,200 US
power plants (all planned/under-construction + operating ≥25 MW, ~96% of capacity),
colored by fuel and sized by megawatts, to show the grid behind the buildout.
`pipeline/fetch_power.py` ingests it → `site/public/data/power-plants.json`. This is
a **separate monthly step** (EIA updates monthly; the workbook is ~14 MB) and is the
only part that needs a dependency (`openpyxl`) — the daily refresh stays stdlib-only.

**Insights & geographic aggregation:** an "Insights" dashboard ranks states by
data-center count vs. generation GW (supply vs. demand), with type/fuel/workload
breakdowns, and an optional **state choropleth** shades the map by either metric.
`build.py` backfills each facility's state via point-in-polygon against
`pipeline/us-states.geojson` (OSM only populates ~half) and emits
`site/public/data/us-states.geojson` for the choropleth.

- **No backend, no database.** The data store is `data-centers.json` + `build-meta.json`,
  hosted on the `gh-pages` branch and fetched by the site at runtime.
- **Front-end:** Vite + TypeScript + MapLibre GL JS, OpenFreeMap dark basemap (no API key).
- **Hosting:** GitHub Pages, served from the `gh-pages` branch. `scripts/deploy.sh`
  builds the site and publishes it there — fully self-contained, no CI required.
  (`docs/deploy-actions.yml.example` is an alternative GitHub Actions workflow if
  you prefer CI deploys; it needs a token with `workflow` scope.)

## The data store

The built JSON is **not committed to this repo.** `gh-pages` is the data store:

```
pipeline/build.py ──▶ site/public/data/data-centers.json   (untracked, ~1.4 MB)
                                    │
                      scripts/publish-data.sh
                      validate ─▶ overlay onto live tree ─▶ orphan commit ─▶ force-push
                                    │
                                    ▼
        https://stephenpadgett1.github.io/data-centers/data/data-centers.json
                                    │  same-origin fetch, no CORS, no API key
                                    ▼
                              site/src/main.ts
```

Why not commit it: it is a derived artifact, minified to a single line, and it
changes completely every day — so every refresh appended ~1.4 MB to history for a
diff that reads `1 file changed, 1 insertion(+), 1 deletion(-)`. `gh-pages` is
force-pushed as a **single orphan commit**, so the payload accrues no history at all.

The *editorial sources* it is built from (`data/curated.json`,
`data/classifications.json`, `data/discovery-seen.json`, `data/geocode-cache.json`)
**stay in git** — those are real source-of-truth with meaningful diffs.

Two properties worth knowing:

- **`deploy.sh` and `publish-data.sh` own different parts of the same branch.**
  Both fetch the live tree, overlay only their own files, and re-publish, so
  neither clobbers the other. A site deploy from a clean checkout — where the
  untracked data files don't exist — carries the live data over rather than
  blanking it.
- **Publishes are verified.** `build.py` writes a `sha256` of the payload into
  `build-meta.json`; `validate.py` checks the two halves agree; `publish-data.sh`
  re-fetches the live URL after pushing and confirms the digest matches. A push
  that doesn't take effect is reported, not silently swallowed.

Manual publish any time:

```bash
python3 pipeline/build.py && ./scripts/publish-data.sh
```

## Local development

```bash
# 1. Pull + build the data (Python stdlib only, no pip install)
#    Required before `npm run dev` — data-centers.json is untracked, so a fresh
#    clone has no data until build.py writes it.
python3 pipeline/fetch.py        # pull OSM Overpass -> data/facilities.raw.json
python3 pipeline/build.py        # merge -> site/public/data/data-centers.json
python3 pipeline/validate.py     # sanity-check the output

# 2. (Optional, monthly) refresh the power-generation layer
pip install -r pipeline/requirements.txt
python3 pipeline/fetch_power.py  # EIA-860M -> site/public/data/power-plants.json

# 3. Run the site
cd site
npm install
npm run dev                      # http://localhost:5173
```

## Daily refresh

The refresh runs through Claude Code (see `scripts/refresh.md` for the exact checklist).
It pulls fresh OSM data, classifies any newly-seen facilities, re-checks the curated
megacampuses, rebuilds the JSON, commits the *editorial sources* to `main`, and
publishes the *built data* to `gh-pages`.

A `launchd` job (`scripts/refresh-cron.sh`) runs this daily on the local machine:

```bash
./scripts/refresh-cron.sh        # one full refresh + publish cycle
```

The daily run no longer rebuilds the site — shipping fresh data is just a JSON
push. Redeploy the site shell only when the front-end changes:

```bash
./scripts/deploy.sh              # build + publish the site to gh-pages
```

## Data & attribution

- Facility locations: © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
- Basemap: [OpenFreeMap](https://openfreemap.org/) © OpenMapTiles.
- Status, capacity, and classifications are editorial estimates generated from public
  sources; treat them as informed approximations, not authoritative records.
