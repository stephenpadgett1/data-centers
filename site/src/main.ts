import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { NavigationControl } from "maplibre-gl";
import type { BuildMeta, DataCenter, PowerPlant } from "./types";
import { createMap, installLayers, toFeatureCollection, categoryColor, type ColorDim } from "./map";
import { installPowerLayers, toPowerFC } from "./power";
import { setupFilters, setupPowerFilters, type Dim, type FilterApi } from "./filters";
import { setupPanel } from "./panel";
import { setupInsights } from "./insights";
import { setupChoropleth } from "./choropleth";

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
    `Facilities © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL) + public announcements · Generation: <a href="https://www.eia.gov/electricity/data/eia860m/" target="_blank" rel="noopener">U.S. EIA Form 860M</a> · Basemap <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>`;

  let records: DataCenter[];
  let meta: BuildMeta;
  let plants: PowerPlant[];
  try {
    const [dc, m, pp] = await Promise.all([
      load<DataCenter[]>("data/data-centers.json"),
      load<BuildMeta>("data/build-meta.json"),
      load<PowerPlant[]>("data/power-plants.json").catch(() => [] as PowerPlant[]),
    ]);
    records = dc;
    meta = m;
    plants = pp;
  } catch (err) {
    toast(`Failed to load data: ${(err as Error).message}`);
    return;
  }

  const byId = new Map(records.map((d) => [d.id, d]));
  const byPlant = new Map(plants.map((p) => [p.id, p]));

  const map = createMap("map");
  const panel = setupPanel(() => {
    handles?.highlight(null);
    powerHandles?.highlight(null);
    history.replaceState(null, "", location.pathname + location.search);
  });

  let handles: ReturnType<typeof installLayers> | undefined;
  let powerHandles: ReturnType<typeof installPowerLayers> | undefined;
  let insights: ReturnType<typeof setupInsights> | undefined;
  let updateStatActive: () => void = () => {};
  const layersOn = { dc: true, power: false };
  let dcShown = 0;
  let powerShown = 0;
  let powerGw = 0;

  function updateShowing() {
    const parts: string[] = [];
    if (layersOn.dc) {
      const totalShown = records.filter((d) => !d.minor).length;
      parts.push(`${dcShown.toLocaleString()} / ${totalShown.toLocaleString()} data centers`);
    }
    if (layersOn.power) {
      parts.push(`${powerShown.toLocaleString()} plants · ${powerGw.toFixed(0)} GW`);
    }
    document.getElementById("showing")!.textContent = parts.length
      ? `Showing ${parts.join("  ·  ")}`
      : "No layers shown";
  }

  function applyFilters() {
    if (!handles) return;
    const filtered = records.filter(filters.predicate);
    handles.setData(toFeatureCollection(filtered));
    handles.setColorBy(activeColorDim(filters));
    handles.setClusterColor(uniformClusterColor(filters));
    dcShown = filtered.length;
    updateShowing();
    updateStatActive();
  }

  function applyPowerFilters() {
    if (!powerHandles) return;
    const filtered = plants.filter(powerFilters.predicate);
    powerHandles.setData(toPowerFC(filtered));
    powerShown = filtered.length;
    powerGw = filtered.reduce((s, p) => s + p.mw, 0) / 1000;
    updateShowing();
  }

  function setLayer(which: "dc" | "power", on: boolean) {
    layersOn[which] = on;
    document.getElementById(which === "dc" ? "layer-dc" : "layer-power")!.classList.toggle("active", on);
    (document.getElementById(which === "dc" ? "dc-controls" : "power-controls") as HTMLElement).hidden = !on;
    if (which === "dc") handles?.setVisible(on);
    else powerHandles?.setVisible(on);
    updateShowing();
  }

  function select(id: string) {
    insights?.close();
    if (id.startsWith("eia/")) {
      const p = byPlant.get(id);
      if (!p || !powerHandles) return;
      if (!layersOn.power) setLayer("power", true);
      panel.open(p);
      handles?.highlight(null);
      powerHandles.highlight(id);
      powerHandles.flyTo(p);
      history.replaceState(null, "", `#pp=${encodeURIComponent(id)}`);
    } else {
      const d = byId.get(id);
      if (!d || !handles) return;
      if (!layersOn.dc) setLayer("dc", true);
      panel.open(d);
      powerHandles?.highlight(null);
      handles.highlight(id);
      handles.flyTo(d);
      history.replaceState(null, "", `#dc=${encodeURIComponent(id)}`);
    }
  }

  function selectFromHash() {
    const pp = location.hash.match(/pp=([^&]+)/);
    const dc = location.hash.match(/dc=([^&]+)/);
    if (pp) select(decodeURIComponent(pp[1]));
    else if (dc) select(decodeURIComponent(dc[1]));
  }

  const filters = setupFilters(records, applyFilters);
  const powerFilters = setupPowerFilters(plants, applyPowerFilters);
  updateStatActive = setupStats(meta, filters);
  document.getElementById("layer-dc")!.addEventListener("click", () => setLayer("dc", !layersOn.dc));
  document.getElementById("layer-power")!.addEventListener("click", () => setLayer("power", !layersOn.power));

  map.on("load", () => {
    clearToast();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    handles = installLayers(map, toFeatureCollection(records.filter(filters.predicate)), select);
    powerHandles = installPowerLayers(map, toPowerFC(plants.filter(powerFilters.predicate)), select);
    handles.setVisible(layersOn.dc);
    powerHandles.setVisible(layersOn.power);

    const choro = setupChoropleth(map, records, plants);
    insights = setupInsights(records, plants, {
      onMetric: choro.setMetric,
      onOpen: () => panel.close(),
    });
    document.getElementById("insights-btn")!.addEventListener("click", () => insights!.open());

    applyFilters();
    applyPowerFilters();
    selectFromHash();
  });

  map.on("error", (e) => console.warn("map error", e?.error ?? e));
}

main();
