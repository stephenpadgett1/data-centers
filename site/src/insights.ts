import type { DataCenter, PowerPlant } from "./types";
import { TYPE_LABELS, TYPE_COLORS, WORKLOAD_LABELS, WORKLOAD_COLORS, FUEL_META } from "./types";
import { byState, byType, byWorkload, byFuelGw, headline } from "./aggregate";

export type ChoroMetric = "off" | "dc" | "gen";

const DC_COLOR = "#2dd4bf"; // data-center demand
const GEN_COLOR = "#f59e0b"; // generation supply

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function barRows(items: { label: string; value: number; color: string; text: string }[]): string {
  const max = Math.max(1, ...items.map((i) => i.value));
  return items
    .map(
      (i) => `<div class="ibar-row">
        <div class="ibar-label">${esc(i.label)}</div>
        <div class="ibar-track"><div class="ibar-fill" style="width:${Math.max(2, (i.value / max) * 100)}%;background:${i.color}"></div></div>
        <div class="ibar-val">${i.text}</div>
      </div>`,
    )
    .join("");
}

function stateTable(dcs: DataCenter[], plants: PowerPlant[]): string {
  const rows = byState(dcs, plants).sort((a, b) => b.dcCount - a.dcCount).slice(0, 12);
  const maxDc = Math.max(1, ...rows.map((r) => r.dcCount));
  const maxGen = Math.max(1, ...rows.map((r) => r.genGw));
  const body = rows
    .map(
      (r) => `<div class="istate-row">
        <div class="istate-code">${r.code}</div>
        <div class="istate-bars">
          <div class="ibar-track"><div class="ibar-fill" style="width:${Math.max(2, (r.dcCount / maxDc) * 100)}%;background:${DC_COLOR}"></div></div>
          <div class="ibar-track"><div class="ibar-fill" style="width:${Math.max(2, (r.genGw / maxGen) * 100)}%;background:${GEN_COLOR}"></div></div>
        </div>
        <div class="istate-vals"><span style="color:${DC_COLOR}">${r.dcCount}</span> · <span style="color:${GEN_COLOR}">${r.genGw.toFixed(0)} GW</span></div>
      </div>`,
    )
    .join("");
  return `<div class="ilegend"><span><i style="background:${DC_COLOR}"></i>data centers (count)</span><span><i style="background:${GEN_COLOR}"></i>generation (GW)</span></div>${body}`;
}

function render(dcs: DataCenter[], plants: PowerPlant[], metric: ChoroMetric): string {
  const h = headline(dcs, plants);
  const stat = (n: string, l: string, c?: string) =>
    `<div class="istat"><div class="istat-num"${c ? ` style="color:${c}"` : ""}>${n}</div><div class="istat-lbl">${l}</div></div>`;

  const typeBars = barRows(byType(dcs).map((t) => ({ label: TYPE_LABELS[t.key], value: t.count, color: TYPE_COLORS[t.key], text: `${t.count}` })));
  const fuelBars = barRows(byFuelGw(plants).map((f) => ({ label: FUEL_META[f.key].label, value: f.gw, color: FUEL_META[f.key].color, text: `${f.gw.toFixed(0)} GW` })));
  const wlBars = barRows(byWorkload(dcs).map((w) => ({ label: WORKLOAD_LABELS[w.key], value: w.count, color: WORKLOAD_COLORS[w.key], text: `${w.count}` })));

  const choroBtn = (m: ChoroMetric, label: string) =>
    `<button class="choro-btn ${metric === m ? "active" : ""}" data-metric="${m}">${label}</button>`;

  return `
    <div class="istats">
      ${stat(h.dcTotal.toLocaleString(), "Data centers")}
      ${stat(h.hyper.toLocaleString(), "Hyperscale")}
      ${stat(h.pipelineDc.toLocaleString(), "DC pipeline")}
      ${stat(`${h.genGw.toFixed(0)}`, "Generation GW", GEN_COLOR)}
      ${stat(`${h.pipelineGw.toFixed(0)}`, "Gen pipeline GW", GEN_COLOR)}
    </div>

    <div class="isection">
      <h3>Shade map by state</h3>
      <div class="choro-switch">${choroBtn("off", "Off")}${choroBtn("dc", "Data centers")}${choroBtn("gen", "Generation GW")}</div>
    </div>

    <div class="isection">
      <h3>Supply vs demand — top states</h3>
      <p class="ihint">Where data centers cluster vs. where the grid generates. Different units, shown side by side.</p>
      ${stateTable(dcs, plants)}
    </div>

    <div class="isection"><h3>Data centers by type</h3>${typeBars}</div>
    <div class="isection"><h3>Generation by fuel</h3>${fuelBars}</div>
    <div class="isection"><h3>Data centers by workload</h3>${wlBars}</div>
  `;
}

export function setupInsights(
  dcs: DataCenter[],
  plants: PowerPlant[],
  opts: { onMetric: (m: ChoroMetric) => void; onOpen?: () => void },
): { open: () => void; close: () => void } {
  const panel = document.getElementById("insights")!;
  const body = document.getElementById("insights-body")!;
  let metric: ChoroMetric = "off";
  let rendered = false;

  function paint() {
    body.innerHTML = render(dcs, plants, metric);
    body.querySelectorAll<HTMLButtonElement>(".choro-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        metric = btn.dataset.metric as ChoroMetric;
        opts.onMetric(metric);
        body.querySelectorAll(".choro-btn").forEach((b) => b.classList.toggle("active", b === btn));
      }),
    );
  }

  function open() {
    if (!rendered) {
      paint();
      rendered = true;
    }
    opts.onOpen?.();
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
  }
  function close() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }

  document.getElementById("insights-close")!.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  return { open, close };
}
