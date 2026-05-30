import {
  type DataCenter,
  STATUS_META,
  TYPE_LABELS,
  WORKLOAD_LABELS,
  PURPOSE_LABELS,
} from "./types";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function fmtArea(sqft: number | null): string | null {
  if (!sqft) return null;
  if (sqft >= 1_000_000) return `${(sqft / 1_000_000).toFixed(1)}M ft²`;
  if (sqft >= 1000) return `${Math.round(sqft / 1000)}k ft²`;
  return `${sqft} ft²`;
}

function fmtCapacity(mw: number | null): string | null {
  if (!mw) return null;
  return mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${mw} MW`;
}

const LINK_LABELS: Record<string, string> = {
  website: "Website ↗",
  osm: "OpenStreetMap ↗",
  wikidata: "Wikidata ↗",
  wikipedia: "Wikipedia ↗",
};

export function renderDetail(d: DataCenter): string {
  const sm = STATUS_META[d.status];
  const cls = d.classification;

  const badges: string[] = [
    `<span class="badge"><span class="k">Type</span>${TYPE_LABELS[cls.operator_type]}</span>`,
    `<span class="badge"><span class="k">Workload</span>${WORKLOAD_LABELS[cls.workload]}</span>`,
    `<span class="badge"><span class="k">Purpose</span>${PURPOSE_LABELS[cls.purpose]}</span>`,
  ];

  const metrics: string[] = [];
  const cap = fmtCapacity(d.capacity_mw);
  const area = fmtArea(d.area_sqft);
  if (cap) metrics.push(`<div class="metric"><div class="num">${cap}</div><div class="lbl">Capacity</div></div>`);
  if (area) metrics.push(`<div class="metric"><div class="num">${area}</div><div class="lbl">Footprint</div></div>`);

  const place = [d.city, d.state].filter(Boolean).join(", ");
  const metaRows: string[] = [];
  if (place) metaRows.push(`<div class="row"><span>Location</span><span>${esc(place)}</span></div>`);
  metaRows.push(
    `<div class="row"><span>Source</span><span>${d.source === "curated" ? "Curated" : "OpenStreetMap"}</span></div>`,
  );
  metaRows.push(`<div class="row"><span>First seen</span><span>${d.first_seen}</span></div>`);

  const links = Object.entries(d.links)
    .filter(([, v]) => v)
    .map(([k, v]) => `<a href="${esc(v!)}" target="_blank" rel="noopener">${LINK_LABELS[k] ?? k}</a>`)
    .join("");

  return `
    <div class="d-status" style="color:${sm.color}">
      <span class="dot" style="background:${sm.color}"></span>${sm.label}
    </div>
    <h2 class="d-name">${esc(d.name)}</h2>
    ${d.operator ? `<div class="d-operator">${esc(d.operator)}</div>` : ""}
    <div class="d-badges">${badges.join("")}</div>
    ${d.summary ? `<p class="d-summary">${esc(d.summary)}</p>` : ""}
    ${metrics.length ? `<div class="d-metrics">${metrics.join("")}</div>` : ""}
    <div class="d-meta">${metaRows.join("")}</div>
    ${links ? `<div class="d-links">${links}</div>` : ""}
    <div class="d-confidence">Classification confidence: ${cls.confidence}${
      cls.confidence === "low" ? " — editorial estimate, may be refined" : ""
    }</div>
  `;
}

export function setupPanel(onClose: () => void) {
  const panel = document.getElementById("detail")!;
  const body = document.getElementById("detail-body")!;
  document.getElementById("detail-close")!.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  function open(d: DataCenter) {
    body.innerHTML = renderDetail(d);
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
  }
  function close() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    onClose();
  }
  return { open, close };
}
