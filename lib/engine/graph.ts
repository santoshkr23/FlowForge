import parser from "cron-parser";
import { CATALOG_BY_TYPE } from "./catalog";
import { PLANS } from "../plans";
import type { Graph, GraphNode, PlanId } from "@/db/schema";

export function findTrigger(g: Graph): GraphNode | undefined {
  return g.nodes.find((n) => n.type.startsWith("trigger."));
}

export function childrenMap(g: Graph) {
  const map = new Map<string, string[]>();
  for (const e of g.edges) {
    if (!map.has(e.source)) map.set(e.source, []);
    map.get(e.source)!.push(e.target);
  }
  // deterministic branch order: top-to-bottom on the canvas
  const pos = new Map(g.nodes.map((n) => [n.id, n.position?.y ?? 0]));
  map.forEach((list) => list.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0)));
  return map;
}

/** Returns a list of human-readable problems; empty = valid. */
export function validateGraph(g: Graph): string[] {
  const problems: string[] = [];
  if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) return ["Graph is malformed"];
  if (g.nodes.length > 200) problems.push("Workflows are limited to 200 steps");
  const triggers = g.nodes.filter((n) => n.type.startsWith("trigger."));
  if (triggers.length === 0) problems.push("Add a trigger (Run manually, Schedule or Webhook)");
  if (triggers.length > 1) problems.push("A workflow can only have one trigger");
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const n of g.nodes) if (!CATALOG_BY_TYPE[n.type]) problems.push(`Unknown step type: ${n.type}`);
  for (const e of g.edges) if (!ids.has(e.source) || !ids.has(e.target)) problems.push("An arrow points to a step that no longer exists");
  for (const t of triggers) if (g.edges.some((e) => e.target === t.id)) problems.push("Nothing can connect into the trigger");
  // cycle check
  const kids = childrenMap(g);
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const c of kids.get(id) ?? []) if (visit(c)) return true;
    state.set(id, 2);
    return false;
  };
  if (g.nodes.some((n) => visit(n.id))) problems.push("Workflows can't loop back on themselves — use an Iterator instead");
  return problems;
}

export type TriggerMeta = { triggerType: string; intervalMin: number | null; cron: string | null };

export function deriveTrigger(g: Graph, plan: PlanId): TriggerMeta {
  const t = findTrigger(g);
  if (!t) return { triggerType: "manual", intervalMin: null, cron: null };
  if (t.type === "trigger.webhook") return { triggerType: "webhook", intervalMin: null, cron: null };
  if (t.type === "trigger.schedule") {
    const c = t.data?.config ?? {};
    const min = PLANS[plan].minIntervalMin;
    if (c.mode === "cron" && c.cron) {
      const cron = String(c.cron).trim();
      try {
        const it = parser.parseExpression(cron, { utc: true });
        const a = it.next().getTime();
        const b = it.next().getTime();
        if ((b - a) / 60000 < min) throw new Error(`Your plan allows schedules every ${min} min at most`);
      } catch (e) {
        throw new Error(`Cron: ${(e as Error).message}`);
      }
      return { triggerType: "schedule", intervalMin: null, cron };
    }
    const interval = Math.max(min, Math.round(Number(c.intervalMin) || 15));
    return { triggerType: "schedule", intervalMin: interval, cron: null };
  }
  return { triggerType: "manual", intervalMin: null, cron: null };
}

export function nextRunAfter(meta: { intervalMin: number | null; cron: string | null }, from = new Date()): Date | null {
  if (meta.cron) {
    try {
      return parser.parseExpression(meta.cron, { utc: true, currentDate: from }).next().toDate();
    } catch {
      return null;
    }
  }
  if (meta.intervalMin) return new Date(from.getTime() + meta.intervalMin * 60_000);
  return null;
}
