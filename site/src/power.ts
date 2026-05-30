import { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import { type PowerPlant, FUEL_META } from "./types";

// Fuel -> color match expression, built from FUEL_META.
const FUEL_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "fuel"],
  ...Object.entries(FUEL_META).flatMap(([k, v]) => [k, v.color]),
  "#94a3b8",
] as unknown as maplibregl.ExpressionSpecification;

// Radius by nameplate capacity (MW). Compressed so 12 GW isn't 500x a 25 MW plant.
const RADIUS_BY_MW: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["get", "mw"],
  25, 3, 100, 5, 500, 8, 1000, 11, 3000, 16, 12000, 24,
];
const GLOW_RADIUS_BY_MW: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["get", "mw"],
  25, 7, 100, 9, 500, 13, 1000, 16, 3000, 22, 12000, 30,
];

const PP_LAYERS = ["pp-clusters", "pp-cluster-count", "pp-glow", "pp-points", "pp-selected"];

export function toPowerFC(plants: PowerPlant[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: plants.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, fuel: p.fuel, status: p.status, mw: p.mw },
    })),
  };
}

export interface PowerHandles {
  setData: (fc: GeoJSON.FeatureCollection) => void;
  flyTo: (p: PowerPlant) => void;
  highlight: (id: string | null) => void;
  setVisible: (visible: boolean) => void;
}

export function installPowerLayers(
  map: MLMap,
  initial: GeoJSON.FeatureCollection,
  onSelect: (id: string) => void,
): PowerHandles {
  map.addSource("pp", {
    type: "geojson",
    data: initial,
    cluster: true,
    clusterRadius: 46,
    clusterMaxZoom: 10,
  });

  // Cluster bubbles — warm/neutral (mixed fuels), distinct from the DC teal.
  map.addLayer({
    id: "pp-clusters",
    type: "circle",
    source: "pp",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#f59e0b",
      "circle-opacity": 0.16,
      "circle-stroke-color": "#fbbf24",
      "circle-stroke-width": 1.3,
      "circle-stroke-opacity": 0.75,
      "circle-radius": ["step", ["get", "point_count"], 13, 25, 18, 100, 25, 500, 33],
    },
  });
  map.addLayer({
    id: "pp-cluster-count",
    type: "symbol",
    source: "pp",
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 12 },
    paint: { "text-color": "#fde68a", "text-halo-color": "#05080f", "text-halo-width": 1 },
  });
  map.addLayer({
    id: "pp-glow",
    type: "circle",
    source: "pp",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": FUEL_COLOR_EXPR,
      "circle-blur": 1,
      "circle-opacity": 0.4,
      "circle-radius": GLOW_RADIUS_BY_MW,
    },
  });
  map.addLayer({
    id: "pp-points",
    type: "circle",
    source: "pp",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": FUEL_COLOR_EXPR,
      "circle-stroke-color": "#05080f",
      "circle-stroke-width": 0.8,
      "circle-opacity": 0.92,
      "circle-radius": RADIUS_BY_MW,
    },
  });
  map.addLayer({
    id: "pp-selected",
    type: "circle",
    source: "pp",
    filter: ["==", ["get", "id"], "__none__"],
    paint: {
      "circle-color": "transparent",
      "circle-radius": 15,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.9,
    },
  });

  map.on("click", "pp-clusters", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    (map.getSource("pp") as GeoJSONSource)
      .getClusterExpansionZoom(f.properties!.cluster_id)
      .then((z) => map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.4 }));
  });
  map.on("click", "pp-points", (e) => {
    const f = e.features?.[0];
    if (f) onSelect(f.properties!.id as string);
  });
  for (const layer of ["pp-clusters", "pp-points"]) {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }

  return {
    setData: (fc) => (map.getSource("pp") as GeoJSONSource).setData(fc),
    flyTo: (p) => map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 9), speed: 0.8 }),
    highlight: (id) => map.setFilter("pp-selected", ["==", ["get", "id"], id ?? "__none__"]),
    setVisible: (visible) => {
      for (const id of PP_LAYERS) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    },
  };
}
