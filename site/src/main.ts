import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { NavigationControl } from "maplibre-gl";
import type { BuildMeta, DataCenter } from "./types";
import { createMap, installLayers, toFeatureCollection, categoryColor, type ColorDim } from "./map";
import { setupFilters, type Dim, type FilterApi } from "./filters";
import { setupPanel } from "./panel";

const BASE = import.meta.env.BASE_URL;

function toast(msg: string) {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
}
function clearToast() {
  document.querySelector(".toast")?.remove();
}

async function load<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// A dimension's active set is "exactly these keys".
function setEquals(set: Set<string>, keys: string[]): boolean {
  return set.size === keys.length && keys.every((k) => set.has(k));
}
function noFilters(f: FilterApi): boolean {
  return (
    (["statuses", "types", "workloads"] as Dim[]).every((dim) =>
      setEquals(f.state[dim], f.present[dim]),
    ) &&
    !f.state.search &&
    !f.state.showMinor &&
    !f.state.capacityOnly
  );
}

// The map dots recolor to match whatever dimension is being filtered, so they
// line up with the colored dots on the sidebar chips.
function activeColorDim(f: FilterApi): ColorDim {
  if (!setEquals(f.state.types, f.present.types)) return "types";
  if (!setEquals(f.state.workloads, f.present.workloads)) return "workloads";
  return "status";
}

// When the active dimension is narrowed to one category, tint the clusters that
// category's color (so the change is visible even when points are clustered).
function uniformClusterColor(f: FilterApi): string | null {
  const dim = activeColorDim(f);
  const set = f.state[dim === "status" ? "statuses" : dim];
  if (set.size !== 1) return null;
  return categoryColor(dim, [...set][0]);
}

interface StatDef {
  num: string;
  lbl: string;
  accent?: boolean;
  reset?: boolean; // "Facilities" -> clear all filters
  capacity?: boolean; // "Tracked GW" -> only facilities with a capacity figure
  dim?: Dim; // interactive: filter this dimension to `keys`
  keys?: string[];
}

/**
 * Build the HUD stat cards. The interactive ones (Hyperscale / Under constr. /
 * Planned) toggle the corresponding map filter; "Facilities" clears all filters.
 * Returns a function that refreshes which cards look "active".
 */
function setupStats(meta: BuildMeta, filters: FilterApi): () => void {
  const uc = meta.by_status.under_construction ?? 0;
  const planned = (meta.by_status.planned ?? 0) + (meta.by_status.announced ?? 0);
  const hyper = meta.by_type.hyperscaler ?? 0;

  const defs: StatDef[] = [
    { num: meta.total.toLocaleString(), lbl: "Facilities", reset: true },
    { num: hyper.toLocaleString(), lbl: "Hyperscale", dim: "types", keys: ["hyperscaler"] },
    { num: uc.toLocaleString(), lbl: "Under constr.", dim: "statuses", keys: ["under_construction"] },
    { num: planned.toLocaleString(), lbl: "Planned", dim: "statuses", keys: ["planned", "announced"] },
  ];
  if (meta.total_capacity_gw > 0) {
    defs.push({ num: `${meta.total_capacity_gw}`, lbl: "Tracked GW", accent: true, capacity: true });
  }

  const container = document.getElementById("stats")!;
  container.innerHTML = "";
  const items: { el: HTMLElement; def: StatDef }[] = [];

  for (const def of defs) {
    const interactive = def.reset || def.capacity || !!def.dim;
    const el = document.createElement(interactive ? "button" : "div");
    el.className = ["stat", def.accent ? "accent" : "", interactive ? "clickable" : ""]
      .filter(Boolean)
      .join(" ");
    el.innerHTML = `<div class="num">${def.num}</div><div class="lbl">${def.lbl}</div>`;

    if (def.reset) {
      el.addEventListener("click", () => filters.resetAll());
    } else if (def.capacity) {
      el.addEventListener("click", () => filters.setCapacityOnly(!filters.state.capacityOnly));
    } else if (def.dim && def.keys) {
      el.addEventListener("click", () => {
        const dim = def.dim!;
        if (setEquals(filters.state[dim], def.keys!)) {
          filters.setDimension(dim, filters.present[dim]); // already active -> clear
        } else {
          filters.setDimension(dim, def.keys!);
        }
      });
    }
    container.appendChild(el);
    items.push({ el, def });
  }

  document.getElementById("refreshed")!.innerHTML =
    `Data refreshed <b>${meta.refreshed_date}</b>`;

  return function updateActive() {
    const clear = noFilters(filters);
    for (const { el, def } of items) {
      let active = false;
      if (def.reset) active = clear;
      else if (def.capacity) active = filters.state.capacityOnly;
      else if (def.dim && def.keys) active = setEquals(filters.state[def.dim], def.keys);
      el.classList.toggle("active", active);
    }
  };
}

function setupCollapsibles() {
  // Mobile: tap the HUD title to collapse/expand the stats, and toggle filters.
  const hud = document.getElementById("hud")!;
  document
    .getElementById("hud-toggle")!
    .addEventListener("click", () => hud.classList.toggle("collapsed"));
  const controls = document.getElementById("controls")!;
  document
    .getElementById("controls-toggle")!
    .addEventListener("click", () => controls.classList.toggle("open"));
}

async function main() {
  toast("Loading data centers…");
  setupCollapsibles();

  document.getElementById("attribution")!.innerHTML =
    `Facilities © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL) + curated public announcements · Basemap <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>`;

  let records: DataCenter[];
  let meta: BuildMeta;
  try {
    [records, meta] = await Promise.all([
      load<DataCenter[]>("data/data-centers.json"),
      load<BuildMeta>("data/build-meta.json"),
    ]);
  } catch (err) {
    toast(`Failed to load data: ${(err as Error).message}`);
    return;
  }

  const byId = new Map(records.map((d) => [d.id, d]));

  const map = createMap("map");
  const panel = setupPanel(() => {
    handles?.highlight(null);
    history.replaceState(null, "", location.pathname + location.search);
  });

  let handles: ReturnType<typeof installLayers> | undefined;
  let updateStatActive: () => void = () => {};

  function applyFilters() {
    if (!handles) return;
    const filtered = records.filter(filters.predicate);
    handles.setData(toFeatureCollection(filtered));
    handles.setColorBy(activeColorDim(filters));
    handles.setClusterColor(uniformClusterColor(filters));
    const totalShown = records.filter((d) => !d.minor).length;
    document.getElementById("showing")!.textContent =
      `Showing ${filtered.length.toLocaleString()} of ${totalShown.toLocaleString()}`;
    updateStatActive();
  }

  function select(id: string) {
    const d = byId.get(id);
    if (!d || !handles) return;
    panel.open(d);
    handles.highlight(id);
    handles.flyTo(d);
    history.replaceState(null, "", `#dc=${encodeURIComponent(id)}`);
  }

  function selectFromHash() {
    const m = location.hash.match(/dc=([^&]+)/);
    if (m) select(decodeURIComponent(m[1]));
  }

  const filters = setupFilters(records, applyFilters);
  updateStatActive = setupStats(meta, filters);

  map.on("load", () => {
    clearToast();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    handles = installLayers(map, toFeatureCollection(records.filter(filters.predicate)), select);
    applyFilters();
    selectFromHash();
  });

  map.on("error", (e) => console.warn("map error", e?.error ?? e));
}

main();
