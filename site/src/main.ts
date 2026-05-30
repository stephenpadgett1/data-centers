import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { NavigationControl } from "maplibre-gl";
import type { BuildMeta, DataCenter } from "./types";
import { createMap, installLayers, toFeatureCollection } from "./map";
import { setupFilters } from "./filters";
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

function renderStats(meta: BuildMeta) {
  const uc = meta.by_status.under_construction ?? 0;
  const planned = (meta.by_status.planned ?? 0) + (meta.by_status.announced ?? 0);
  const hyper = meta.by_type.hyperscaler ?? 0;
  const stats: { num: string; lbl: string; accent?: boolean }[] = [
    { num: meta.total.toLocaleString(), lbl: "Facilities" },
    { num: hyper.toLocaleString(), lbl: "Hyperscale" },
    { num: uc.toLocaleString(), lbl: "Under constr." },
    { num: planned.toLocaleString(), lbl: "Planned" },
  ];
  if (meta.total_capacity_gw > 0) {
    stats.push({ num: `${meta.total_capacity_gw}`, lbl: "Tracked GW", accent: true });
  }
  document.getElementById("stats")!.innerHTML = stats
    .map(
      (s) =>
        `<div class="stat ${s.accent ? "accent" : ""}"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>`,
    )
    .join("");

  document.getElementById("refreshed")!.innerHTML =
    `Data refreshed <b>${meta.refreshed_date}</b>`;
}

function setupMobileToggle() {
  const controls = document.getElementById("controls")!;
  document
    .getElementById("controls-toggle")!
    .addEventListener("click", () => controls.classList.toggle("open"));
}

async function main() {
  toast("Loading data centers…");
  setupMobileToggle();

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

  renderStats(meta);
  const byId = new Map(records.map((d) => [d.id, d]));

  const map = createMap("map");
  const panel = setupPanel(() => {
    handles.highlight(null);
    history.replaceState(null, "", location.pathname + location.search);
  });

  let handles: ReturnType<typeof installLayers>;
  let predicate: (d: DataCenter) => boolean;

  function applyFilters() {
    const filtered = records.filter(predicate);
    handles.setData(toFeatureCollection(filtered));
    const totalShown = records.filter((d) => !d.minor).length;
    document.getElementById("showing")!.textContent =
      `Showing ${filtered.length.toLocaleString()} of ${totalShown.toLocaleString()}`;
  }

  function select(id: string) {
    const d = byId.get(id);
    if (!d) return;
    panel.open(d);
    handles.highlight(id);
    handles.flyTo(d);
    history.replaceState(null, "", `#dc=${encodeURIComponent(id)}`);
  }

  function selectFromHash() {
    const m = location.hash.match(/dc=([^&]+)/);
    if (m) select(decodeURIComponent(m[1]));
  }

  const filters = setupFilters(records, () => applyFilters());
  predicate = filters.predicate;

  map.on("load", () => {
    clearToast();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    handles = installLayers(map, toFeatureCollection(records.filter(predicate)), select);
    applyFilters();
    selectFromHash();
  });

  map.on("error", (e) => console.warn("map error", e?.error ?? e));
}

main();
