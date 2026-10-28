import { and, count, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { deriveTrigger, findTrigger, nextRunAfter, validateGraph } from "./engine/graph";
import { PLANS } from "./plans";
import { CATALOG_BY_TYPE } from "./engine/catalog";
import { randomToken } from "./crypto";
import { HttpError } from "./http";
import type { Graph, Org } from "@/db/schema";

export const EMPTY_GRAPH: Graph = {
  nodes: [{ id: "trigger", type: "trigger.manual", position: { x: 80, y: 160 }, data: { label: "Run manually", config: { sample: "{}" } } }],
  edges: [],
};

export async function getWorkflow(orgId: string, id: string) {
  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(and(eq(schema.workflows.id, id), eq(schema.workflows.orgId, orgId)))
    .limit(1);
  if (!wf) throw new HttpError(404, "Workflow not found");
  return wf;
}

export async function createWorkflow(org: Org, userId: string | null, name: string, graph: Graph = EMPTY_GRAPH, description?: string) {
  const meta = deriveTrigger(graph, org.plan);
  const [wf] = await db
    .insert(schema.workflows)
    .values({ orgId: org.id, name, description, graph, createdById: userId, webhookToken: randomToken(18), ...meta })
    .returning();
  return wf;
}

export async function saveWorkflow(org: Org, id: string, patch: { name?: string; description?: string | null; folder?: string | null; graph?: Graph }) {
  const wf = await getWorkflow(org.id, id);
  const update: Partial<typeof schema.workflows.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.folder !== undefined) update.folder = patch.folder;
  if (patch.graph) {
    let meta;
    try {
      meta = deriveTrigger(patch.graph, org.plan);
    } catch (e) {
      throw new HttpError(422, (e as Error).message);
    }
    Object.assign(update, { graph: patch.graph, ...meta });
    // a changed trigger (e.g. a different feed or store) starts watching from "now" again
    const before = JSON.stringify(findTrigger(wf.graph) ? { t: findTrigger(wf.graph)!.type, c: findTrigger(wf.graph)!.data?.config } : null);
    const after = JSON.stringify(findTrigger(patch.graph) ? { t: findTrigger(patch.graph)!.type, c: findTrigger(patch.graph)!.data?.config } : null);
    if (before !== after) update.pollState = null;
    // an active workflow whose graph became invalid gets switched off
    const problems = validateGraph(patch.graph);
    if (wf.active && problems.length) update.active = false;
    update.nextRunAt = (update.active ?? wf.active) && meta.triggerType === "schedule" ? nextRunAfter(meta) : null;
  }
  const [saved] = await db.update(schema.workflows).set(update).where(eq(schema.workflows.id, id)).returning();
  return saved;
}

export async function setActive(org: Org, id: string, active: boolean) {
  const wf = await getWorkflow(org.id, id);
  if (active) {
    const problems = validateGraph(wf.graph);
    if (problems.length) throw new HttpError(422, problems[0]);
    const limit = PLANS[org.plan].activeWorkflows;
    if (limit >= 0 && !wf.active) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.workflows)
        .where(and(eq(schema.workflows.orgId, org.id), eq(schema.workflows.active, true)));
      if (n >= limit) throw new HttpError(402, `Your ${PLANS[org.plan].name} plan allows ${limit} active workflows. Upgrade to activate more.`);
    }
  }
  const nextRunAt = active && wf.triggerType === "schedule" ? nextRunAfter(wf) : null;
  const [saved] = await db.update(schema.workflows).set({ active, nextRunAt }).where(eq(schema.workflows.id, id)).returning();
  // watch triggers: record "where things stand now" right away, so items arriving before the first check aren't missed
  const t = findTrigger(saved.graph);
  if (active && t && CATALOG_BY_TYPE[t.type]?.poll && !saved.pollState) {
    const { checkWatch } = await import("./engine/scheduler");
    await checkWatch(saved);
  }
  return saved;
}
