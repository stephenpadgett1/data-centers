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

export const WORKLOAD_LABELS: Record<Workload, string> = {
  ai: "AI / accelerated",
  general: "General compute",
  mixed: "Mixed",
  unknown: "Unknown",
};

export const PURPOSE_LABELS: Record<Purpose, string> = {
  purpose_built: "Purpose-built",
  speculative: "Speculative",
  multi_tenant: "Multi-tenant",
  unknown: "Unknown",
};
