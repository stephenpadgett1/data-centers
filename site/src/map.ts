import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import { type DataCenter, type Status, STATUS_META, TYPE_COLORS, WORKLOAD_COLORS } from "./types";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export type ColorDim = "status" | "types" | "workloads";

const FALLBACK_COLOR = "#64748b";

/** Build a MapLibre `match` color expression from a {category -> color} map. */
function colorExpr(prop: string, colors: Record<string, string>): maplibregl.ExpressionSpecification {
  const expr: unknown[] = ["match", ["get", prop]];
  for (const [key, color] of Object.entries(colors)) expr.push(key, color);
  expr.push(FALLBACK_COLOR);
  return expr as maplibregl.ExpressionSpecification;
}

const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_META).map(([k, v]) => [k, v.color]),
);

const COLOR_EXPR: Record<ColorDim, maplibregl.ExpressionSpecification> = {
  status: colorExpr("status", STATUS_COLORS),
  types: colorExpr("otype", TYPE_COLORS),
  workloads: colorExpr("workload", WORKLOAD_COLORS),
};
const STATUS_COLOR_EXPR = COLOR_EXPR.status;

const CLUSTER_DEFAULT = { fill: "#14b8a6", stroke: "#2dd4bf" };

/** Color for a single category within a dimension (for the cluster tint + legend). */
export function categoryColor(dim: ColorDim, key: string): string {
  const map = dim === "types" ? TYPE_COLORS : dim === "workloads" ? WORKLOAD_COLORS : STATUS_COLORS;
  return (map as Record<string, string>)[key] ?? FALLBACK_COLOR;
}

export function createMap(container: string): MLMap {
  return new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [-97.5, 38.7],
    zoom: 3.7,
    minZoom: 2.5,
    maxZoom: 17,
    attributionControl: false,
  });
}

export function toFeatureCollection(records: DataCenter[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: records.map((d) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [d.lng, d.lat] },
      properties: {
        id: d.id,
        status: d.status,
        otype: d.classification.operator_type,
        workload: d.classification.workload,
        cap: d.capacity_mw ?? 0,
        curated: d.source === "curated" ? 1 : 0,
      },
    })),
  };
}

export interface MapHandles {
  setData: (fc: GeoJSON.FeatureCollection) => void;
  flyTo: (d: DataCenter) => void;
  highlight: (id: string | null) => void;
  setColorBy: (dim: ColorDim) => void;
  /** Tint the cluster bubbles a single color, or null to reset to default. */
  setClusterColor: (color: string | null) => void;
  /** Show/hide the whole data-center layer (for the layer switcher). */
  setVisible: (visible: boolean) => void;
}

const DC_LAYERS = ["clusters", "cluster-count", "points-glow", "points", "selected"];

export function installLayers(
  map: MLMap,
  initial: GeoJSON.FeatureCollection,
  onSelect: (id: string) => void,
): MapHandles {
  map.addSource("dc", {
    type: "geojson",
    data: initial,
    cluster: true,
    clusterRadius: 48,
    clusterMaxZoom: 11,
  });

  // --- cluster bubbles ---
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "dc",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#14b8a6",
      "circle-opacity": 0.18,
      "circle-stroke-color": "#2dd4bf",
      "circle-stroke-width": 1.4,
      "circle-stroke-opacity": 0.8,
      "circle-radius": [
        "step",
        ["get", "point_count"],
        14,
        25,
        19,
        100,
        26,
        500,
        34,
      ],
    },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "dc",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#d4def0",
      "text-halo-color": "#05080f",
      "text-halo-width": 1,
    },
  });

  // --- glow underlay for individual points ---
  map.addLayer({
    id: "points-glow",
    type: "circle",
    source: "dc",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": STATUS_COLOR_EXPR,
      "circle-blur": 1,
      "circle-opacity": 0.45,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        ["case", [">", ["get", "cap"], 0], 11, 7],
        12,
        ["case", [">", ["get", "cap"], 0], 22, 14],
      ],
    },
  });

  // --- the points themselves ---
  map.addLayer({
    id: "points",
    type: "circle",
    source: "dc",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": STATUS_COLOR_EXPR,
      "circle-stroke-color": "#05080f",
      "circle-stroke-width": 1,
      "circle-opacity": 0.95,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        ["case", [">", ["get", "cap"], 0], 6, 4],
        12,
        ["case", [">", ["get", "cap"], 0], 11, 7],
      ],
    },
  });

  // --- selection ring ---
  map.addLayer({
    id: "selected",
    type: "circle",
    source: "dc",
    filter: ["==", ["get", "id"], "__none__"],
    paint: {
      "circle-color": "transparent",
      "circle-radius": 13,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.9,
    },
  });

  // --- interactions ---
  map.on("click", "clusters", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const clusterId = f.properties!.cluster_id;
    const src = map.getSource("dc") as GeoJSONSource;
    src.getClusterExpansionZoom(clusterId).then((zoom) => {
      map.easeTo({
        center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
        zoom: zoom + 0.4,
      });
    });
  });

  map.on("click", "points", (e) => {
    const f = e.features?.[0];
    if (f) onSelect(f.properties!.id as string);
  });

  for (const layer of ["clusters", "points"]) {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }

  return {
    setData: (fc) => (map.getSource("dc") as GeoJSONSource).setData(fc),
    flyTo: (d) =>
      map.flyTo({ center: [d.lng, d.lat], zoom: Math.max(map.getZoom(), 11), speed: 0.8 }),
    highlight: (id) =>
      map.setFilter("selected", ["==", ["get", "id"], id ?? "__none__"]),
    setColorBy: (dim) => {
      map.setPaintProperty("points", "circle-color", COLOR_EXPR[dim]);
      map.setPaintProperty("points-glow", "circle-color", COLOR_EXPR[dim]);
    },
    setClusterColor: (color) => {
      map.setPaintProperty("clusters", "circle-color", color ?? CLUSTER_DEFAULT.fill);
      map.setPaintProperty("clusters", "circle-stroke-color", color ?? CLUSTER_DEFAULT.stroke);
    },
    setVisible: (visible) => {
      for (const id of DC_LAYERS) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    },
  };
}

export const statusColor = (s: Status): string =>
  ({
    operational: "#2dd4bf",
    under_construction: "#fbbf24",
    planned: "#a78bfa",
    announced: "#60a5fa",
    unknown: "#64748b",
  })[s];
