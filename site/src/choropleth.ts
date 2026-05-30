import { type Map as MLMap } from "maplibre-gl";
import type maplibregl from "maplibre-gl";
import type { DataCenter, PowerPlant } from "./types";
import { byState } from "./aggregate";
import type { ChoroMetric } from "./insights";

const BASE = import.meta.env.BASE_URL;
const TRANSPARENT = "rgba(0,0,0,0)";
// dark -> bright sequential shades
const DC_SHADES = ["#103e3a", "#16695f", "#1f9d8f", "#28c2b1", "#5ef0df"];
const GEN_SHADES = ["#3d2408", "#6e3f0b", "#a85f0e", "#db8412", "#f7b53e"];
const RATIO_CUTS = [0.08, 0.2, 0.4, 0.65]; // -> 5 buckets

export function setupChoropleth(map: MLMap, dcs: DataCenter[], plants: PowerPlant[]) {
  const rows = byState(dcs, plants);
  const dcVals = new Map(rows.map((r) => [r.code, r.dcCount]));
  const genVals = new Map(rows.map((r) => [r.code, r.genGw]));
  let added = false;

  async function ensureLayer() {
    if (added) return;
    const gj = await (await fetch(`${BASE}data/us-states.geojson`)).json();
    map.addSource("states", { type: "geojson", data: gj });
    const before = map.getLayer("clusters") ? "clusters" : undefined;
    map.addLayer(
      {
        id: "states-fill",
        type: "fill",
        source: "states",
        paint: {
          "fill-color": TRANSPARENT,
          "fill-opacity": 0.6,
          "fill-outline-color": "rgba(120,160,210,0.28)",
        },
      },
      before,
    );
    added = true;
  }

  function build(metric: "dc" | "gen") {
    const vals = metric === "dc" ? dcVals : genVals;
    const shades = metric === "dc" ? DC_SHADES : GEN_SHADES;
    const max = Math.max(1, ...vals.values());
    const expr: unknown[] = ["match", ["get", "code"]];
    for (const [code, v] of vals) {
      if (v <= 0) continue;
      const ratio = v / max;
      let bi = RATIO_CUTS.findIndex((t) => ratio < t);
      if (bi < 0) bi = shades.length - 1;
      expr.push(code, shades[bi]);
    }
    expr.push(TRANSPARENT);
    return { expr: expr as unknown as maplibregl.ExpressionSpecification, max, shades };
  }

  function renderLegend(metric: "dc" | "gen", max: number, shades: string[]) {
    const el = document.getElementById("choro-legend")!;
    el.hidden = false;
    el.innerHTML = `
      <div class="cl-title">${metric === "dc" ? "Data centers / state" : "Generation / state"}</div>
      <div class="cl-scale">${shades.map((c) => `<i style="background:${c}"></i>`).join("")}</div>
      <div class="cl-range"><span>low</span><span>${metric === "dc" ? max.toLocaleString() : `${max.toFixed(0)} GW`}</span></div>`;
  }

  async function setMetric(metric: ChoroMetric) {
    const legend = document.getElementById("choro-legend")!;
    if (metric === "off") {
      if (added) map.setPaintProperty("states-fill", "fill-color", TRANSPARENT);
      legend.hidden = true;
      return;
    }
    await ensureLayer();
    const { expr, max, shades } = build(metric);
    map.setPaintProperty("states-fill", "fill-color", expr);
    renderLegend(metric, max, shades);
  }

  return { setMetric };
}
