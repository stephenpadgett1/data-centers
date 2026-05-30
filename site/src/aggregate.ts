import type { DataCenter, PowerPlant, OperatorType, Workload, Fuel } from "./types";

export interface StateRow {
  code: string;
  dcCount: number;
  genGw: number; // operational generation
  pipelineGw: number; // planned + under construction
}

export interface Headline {
  dcTotal: number;
  hyper: number;
  pipelineDc: number; // under construction + planned + announced
  plantTotal: number;
  genGw: number;
  pipelineGw: number;
}

const liveDcs = (dcs: DataCenter[]) => dcs.filter((d) => !d.minor);

export function byState(dcs: DataCenter[], plants: PowerPlant[]): StateRow[] {
  const m = new Map<string, StateRow>();
  const row = (c: string) =>
    m.get(c) ?? m.set(c, { code: c, dcCount: 0, genGw: 0, pipelineGw: 0 }).get(c)!;
  for (const d of liveDcs(dcs)) if (d.state) row(d.state).dcCount++;
  for (const p of plants) {
    if (!p.state) continue;
    const r = row(p.state);
    if (p.status === "operational") r.genGw += p.mw / 1000;
    else r.pipelineGw += p.mw / 1000;
  }
  return [...m.values()];
}

export function headline(dcs: DataCenter[], plants: PowerPlant[]): Headline {
  const nd = liveDcs(dcs);
  const pipe = new Set(["under_construction", "planned", "announced"]);
  return {
    dcTotal: nd.length,
    hyper: nd.filter((d) => d.classification.operator_type === "hyperscaler").length,
    pipelineDc: nd.filter((d) => pipe.has(d.status)).length,
    plantTotal: plants.length,
    genGw: plants.filter((p) => p.status === "operational").reduce((s, p) => s + p.mw, 0) / 1000,
    pipelineGw: plants.filter((p) => p.status !== "operational").reduce((s, p) => s + p.mw, 0) / 1000,
  };
}

function countBy<K extends string>(items: K[]): { key: K; count: number }[] {
  const m = new Map<K, number>();
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

export function byType(dcs: DataCenter[]): { key: OperatorType; count: number }[] {
  return countBy(liveDcs(dcs).map((d) => d.classification.operator_type));
}

export function byWorkload(dcs: DataCenter[]): { key: Workload; count: number }[] {
  return countBy(liveDcs(dcs).map((d) => d.classification.workload));
}

export function byFuelGw(plants: PowerPlant[]): { key: Fuel; gw: number }[] {
  const m = new Map<Fuel, number>();
  for (const p of plants) m.set(p.fuel, (m.get(p.fuel) ?? 0) + p.mw / 1000);
  return [...m.entries()].map(([key, gw]) => ({ key, gw })).sort((a, b) => b.gw - a.gw);
}
