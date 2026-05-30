import {
  type DataCenter,
  type PowerPlant,
  type Status,
  type Fuel,
  type OperatorType,
  type Workload,
  STATUS_META,
  TYPE_LABELS,
  TYPE_COLORS,
  WORKLOAD_LABELS,
  WORKLOAD_COLORS,
  FUEL_META,
  FUEL_ORDER,
} from "./types";

const STATUS_ORDER: Status[] = [
  "operational",
  "under_construction",
  "planned",
  "announced",
];
const TYPE_ORDER: OperatorType[] = [
  "hyperscaler",
  "colocation",
  "enterprise",
  "crypto",
  "telecom",
  "government",
  "education",
  "unknown",
];
const WORKLOAD_ORDER: Workload[] = ["ai", "general", "mixed", "unknown"];

export type Dim = "statuses" | "types" | "workloads";

export interface FilterState {
  statuses: Set<string>;
  types: Set<string>;
  workloads: Set<string>;
  search: string;
  showMinor: boolean;
  capacityOnly: boolean;
}

export interface FilterApi {
  state: FilterState;
  predicate: (d: DataCenter) => boolean;
  present: Record<Dim, string[]>;
  /** Replace a dimension's active set (and sync the chips). */
  setDimension: (dim: Dim, keys: string[]) => void;
  /** Toggle "only facilities with a tracked capacity (MW)". */
  setCapacityOnly: (v: boolean) => void;
  /** Clear all filters back to "everything present". */
  resetAll: () => void;
}

export function setupFilters(records: DataCenter[], onChange: () => void): FilterApi {
  // Only show categories that actually occur in the data.
  const present: Record<Dim, string[]> = {
    statuses: STATUS_ORDER.filter((s) => records.some((d) => d.status === s)),
    types: TYPE_ORDER.filter((t) => records.some((d) => d.classification.operator_type === t)),
    workloads: WORKLOAD_ORDER.filter((w) => records.some((d) => d.classification.workload === w)),
  };

  const state: FilterState = {
    statuses: new Set(present.statuses),
    types: new Set(present.types),
    workloads: new Set(present.workloads),
    search: "",
    showMinor: false,
    capacityOnly: false,
  };

  // chip element registry, per dimension, keyed by category
  const chips: Record<Dim, Map<string, HTMLButtonElement>> = {
    statuses: new Map(),
    types: new Map(),
    workloads: new Map(),
  };

  function chipGroup(
    containerId: string,
    dim: Dim,
    label: string,
    items: { key: string; label: string; color?: string }[],
  ) {
    const el = document.getElementById(containerId)!;
    el.innerHTML = `<span class="group-label">${label}</span>`;
    const set = state[dim];
    for (const it of items) {
      const chip = document.createElement("button");
      chip.className = "chip active";
      chip.dataset.key = it.key;
      chip.innerHTML =
        (it.color ? `<span class="dot" style="background:${it.color};color:${it.color}"></span>` : "") +
        it.label;
      chip.addEventListener("click", () => {
        if (set.has(it.key)) set.delete(it.key);
        else set.add(it.key);
        chip.classList.toggle("active", set.has(it.key));
        onChange();
      });
      chips[dim].set(it.key, chip);
      el.appendChild(chip);
    }
  }

  chipGroup(
    "filter-status",
    "statuses",
    "Status",
    present.statuses.map((s) => ({ key: s, label: STATUS_META[s as Status].label, color: STATUS_META[s as Status].color })),
  );
  chipGroup(
    "filter-type",
    "types",
    "Operator type",
    present.types.map((t) => ({
      key: t,
      label: TYPE_LABELS[t as OperatorType],
      color: TYPE_COLORS[t as OperatorType],
    })),
  );
  chipGroup(
    "filter-workload",
    "workloads",
    "Workload",
    present.workloads.map((w) => ({
      key: w,
      label: WORKLOAD_LABELS[w as Workload],
      color: WORKLOAD_COLORS[w as Workload],
    })),
  );

  const search = document.getElementById("search") as HTMLInputElement;
  search.addEventListener("input", () => {
    state.search = search.value.trim().toLowerCase();
    onChange();
  });

  const minor = document.getElementById("show-minor") as HTMLInputElement;
  minor.addEventListener("change", () => {
    state.showMinor = minor.checked;
    onChange();
  });

  function syncChips(dim: Dim) {
    for (const [key, chip] of chips[dim]) {
      chip.classList.toggle("active", state[dim].has(key));
    }
  }

  function setDimension(dim: Dim, keys: string[]) {
    state[dim] = new Set(keys);
    syncChips(dim);
    onChange();
  }

  function setCapacityOnly(v: boolean) {
    state.capacityOnly = v;
    onChange();
  }

  function resetAll() {
    state.statuses = new Set(present.statuses);
    state.types = new Set(present.types);
    state.workloads = new Set(present.workloads);
    state.search = "";
    state.showMinor = false;
    state.capacityOnly = false;
    search.value = "";
    minor.checked = false;
    (["statuses", "types", "workloads"] as Dim[]).forEach(syncChips);
    onChange();
  }

  const predicate = (d: DataCenter): boolean => {
    if (!state.showMinor && d.minor) return false;
    if (state.capacityOnly && d.capacity_mw == null) return false;
    if (!state.statuses.has(d.status)) return false;
    if (!state.types.has(d.classification.operator_type)) return false;
    if (!state.workloads.has(d.classification.workload)) return false;
    if (state.search) {
      const hay = `${d.name} ${d.operator ?? ""} ${d.city ?? ""} ${d.state ?? ""}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  };

  return { state, predicate, present, setDimension, setCapacityOnly, resetAll };
}

// ---------- Power-plant filters (fuel + status) ----------

export interface PowerFilterState {
  fuels: Set<string>;
  statuses: Set<string>;
}

export function setupPowerFilters(
  plants: PowerPlant[],
  onChange: () => void,
): { state: PowerFilterState; predicate: (p: PowerPlant) => boolean } {
  const presentFuels = FUEL_ORDER.filter((f) => plants.some((p) => p.fuel === f));
  const presentStatus = (["operational", "under_construction", "planned"] as Status[]).filter(
    (s) => plants.some((p) => p.status === s),
  );
  const state: PowerFilterState = {
    fuels: new Set(presentFuels),
    statuses: new Set(presentStatus),
  };

  function group(containerId: string, label: string, items: { key: string; label: string; color: string }[], set: Set<string>) {
    const el = document.getElementById(containerId)!;
    el.innerHTML = `<span class="group-label">${label}</span>`;
    for (const it of items) {
      const chip = document.createElement("button");
      chip.className = "chip active";
      chip.innerHTML = `<span class="dot" style="background:${it.color};color:${it.color}"></span>${it.label}`;
      chip.addEventListener("click", () => {
        if (set.has(it.key)) set.delete(it.key);
        else set.add(it.key);
        chip.classList.toggle("active", set.has(it.key));
        onChange();
      });
      el.appendChild(chip);
    }
  }

  group("filter-fuel", "Fuel", presentFuels.map((f) => ({ key: f, label: FUEL_META[f as Fuel].label, color: FUEL_META[f as Fuel].color })), state.fuels);
  group("filter-pstatus", "Status", presentStatus.map((s) => ({ key: s, label: STATUS_META[s].label, color: STATUS_META[s].color })), state.statuses);

  const predicate = (p: PowerPlant): boolean =>
    state.fuels.has(p.fuel) && state.statuses.has(p.status);

  return { state, predicate };
}
