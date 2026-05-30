export type Status =
  | "operational"
  | "under_construction"
  | "planned"
  | "announced"
  | "unknown";

export type OperatorType =
  | "hyperscaler"
  | "colocation"
  | "enterprise"
  | "crypto"
  | "telecom"
  | "government"
  | "education"
  | "unknown";

export type Workload = "ai" | "general" | "mixed" | "unknown";
export type Purpose = "purpose_built" | "speculative" | "multi_tenant" | "unknown";

export interface Classification {
  operator_type: OperatorType;
  purpose: Purpose;
  workload: Workload;
  confidence: "high" | "medium" | "low";
}

export interface DataCenter {
  id: string;
  source: "osm" | "curated";
  name: string;
  operator: string | null;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  postcode: string | null;
  status: Status;
  capacity_mw: number | null;
  area_sqft: number | null;
  minor: boolean;
  classification: Classification;
  summary: string;
  links: {
    website?: string;
    osm?: string;
    wikidata?: string;
    wikipedia?: string;
  };
  sources: string[];
  first_seen: string;
  last_seen: string;
}

export interface BuildMeta {
  built_at: string;
  refreshed_date: string;
  total: number;
  from_osm: number;
  from_curated: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  total_capacity_mw: number;
  total_capacity_gw: number;
  unclassified: number;
  attribution: string;
}

export const STATUS_META: Record<
  Status,
  { label: string; color: string }
> = {
  operational: { label: "Operational", color: "#2dd4bf" },
  under_construction: { label: "Under construction", color: "#fbbf24" },
  planned: { label: "Planned", color: "#a78bfa" },
  announced: { label: "Announced", color: "#60a5fa" },
  unknown: { label: "Unknown", color: "#64748b" },
};

export const TYPE_LABELS: Record<OperatorType, string> = {
  hyperscaler: "Hyperscaler",
  colocation: "Colocation",
  enterprise: "Enterprise",
  crypto: "Crypto-mining",
  telecom: "Telecom",
  government: "Government",
  education: "Research / Edu",
  unknown: "Unclassified",
};

export const TYPE_COLORS: Record<OperatorType, string> = {
  hyperscaler: "#f472b6", // pink
  colocation: "#38bdf8", // sky
  enterprise: "#a3e635", // lime
  crypto: "#fb923c", // orange
  telecom: "#c084fc", // purple
  government: "#cbd5e1", // light slate
  education: "#fde047", // yellow
  unknown: "#64748b", // slate
};

export const WORKLOAD_LABELS: Record<Workload, string> = {
  ai: "AI / accelerated",
  general: "General compute",
  mixed: "Mixed",
  unknown: "Unknown",
};

export const WORKLOAD_COLORS: Record<Workload, string> = {
  ai: "#fb7185", // rose
  general: "#22d3ee", // cyan
  mixed: "#c4b5fd", // light violet
  unknown: "#64748b", // slate
};

export const PURPOSE_LABELS: Record<Purpose, string> = {
  purpose_built: "Purpose-built",
  speculative: "Speculative",
  multi_tenant: "Multi-tenant",
  unknown: "Unknown",
};

// ---------- Power generation (EIA Form 860M) ----------

export type Fuel =
  | "gas"
  | "coal"
  | "solar"
  | "wind"
  | "nuclear"
  | "hydro"
  | "battery"
  | "petroleum"
  | "geothermal"
  | "biomass"
  | "other";

export interface PowerPlant {
  id: string;
  name: string;
  state: string | null;
  county: string | null;
  lat: number;
  lng: number;
  mw: number;
  fuel: Fuel;
  status: Status; // operating | under_construction | planned
  year: number | null;
  operator: string | null;
}

export interface PowerMeta {
  built_at: string;
  source: string;
  min_mw: number;
  total_plants: number;
  by_status: Record<string, number>;
  by_fuel: Record<string, number>;
  gw_by_fuel: Record<string, number>;
  total_gw: number;
  operating_gw: number;
  pipeline_gw: number;
}

export const FUEL_META: Record<Fuel, { label: string; color: string }> = {
  gas: { label: "Natural gas", color: "#f97316" },
  coal: { label: "Coal", color: "#9ca3af" },
  solar: { label: "Solar", color: "#facc15" },
  wind: { label: "Wind", color: "#38bdf8" },
  nuclear: { label: "Nuclear", color: "#a855f7" },
  hydro: { label: "Hydro", color: "#2dd4bf" },
  battery: { label: "Battery", color: "#4ade80" },
  petroleum: { label: "Petroleum", color: "#b45309" },
  geothermal: { label: "Geothermal", color: "#fb7185" },
  biomass: { label: "Biomass", color: "#84cc16" },
  other: { label: "Other", color: "#94a3b8" },
};

export const FUEL_ORDER: Fuel[] = [
  "gas", "solar", "wind", "nuclear", "hydro", "coal",
  "battery", "petroleum", "geothermal", "biomass", "other",
];
