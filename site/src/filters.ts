import {
  type DataCenter,
  type Status,
  type OperatorType,
  type Workload,
  STATUS_META,
  TYPE_LABELS,
  WORKLOAD_LABELS,
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

export interface FilterState {
  statuses: Set<string>;
  types: Set<string>;
  workloads: Set<string>;
  search: string;
  showMinor: boolean;
}

export function setupFilters(
  records: DataCenter[],
  onChange: () => void,
): { state: FilterState; predicate: (d: DataCenter) => boolean } {
  // Only show categories that actually occur in the data.
  const presentStatuses = new Set(records.map((d) => d.status));
  const presentTypes = new Set(records.map((d) => d.classification.operator_type));
  const presentWorkloads = new Set(records.map((d) => d.classification.workload));

  const state: FilterState = {
    statuses: new Set([...presentStatuses]),
    types: new Set([...presentTypes]),
    workloads: new Set([...presentWorkloads]),
    search: "",
    showMinor: false,
  };

  function chipGroup(
    containerId: string,
    label: string,
    items: { key: string; label: string; color?: string }[],
    set: Set<string>,
  ) {
    const el = document.getElementById(containerId)!;
    el.innerHTML = `<span class="group-label">${label}</span>`;
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
      el.appendChild(chip);
    }
  }

  chipGroup(
    "filter-status",
    "Status",
    STATUS_ORDER.filter((s) => presentStatuses.has(s)).map((s) => ({
      key: s,
      label: STATUS_META[s].label,
      color: STATUS_META[s].color,
    })),
    state.statuses,
  );
  chipGroup(
    "filter-type",
    "Operator type",
    TYPE_ORDER.filter((t) => presentTypes.has(t)).map((t) => ({
      key: t,
      label: TYPE_LABELS[t],
    })),
    state.types,
  );
  chipGroup(
    "filter-workload",
    "Workload",
    WORKLOAD_ORDER.filter((w) => presentWorkloads.has(w)).map((w) => ({
      key: w,
      label: WORKLOAD_LABELS[w],
    })),
    state.workloads,
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

  const predicate = (d: DataCenter): boolean => {
    if (!state.showMinor && d.minor) return false;
    if (!state.statuses.has(d.status)) return false;
    if (!state.types.has(d.classification.operator_type)) return false;
    if (!state.workloads.has(d.classification.workload)) return false;
    if (state.search) {
      const hay = `${d.name} ${d.operator ?? ""} ${d.city ?? ""} ${d.state ?? ""}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  };

  return { state, predicate };
}
