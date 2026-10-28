import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { startRun } from "./engine/queue";
import { validateGraph, findTrigger } from "./engine/graph";
import { creditsRemaining } from "./credits";
import { planAllows } from "./plans";
import { HttpError } from "./http";
import type { Org } from "@/db/schema";

/** Shared by the REST API (/api/v1) and the MCP server (/api/mcp). */
export async function apiListWorkflows(org: Org) {
  const rows = await db
    .select({ id: schema.workflows.id, name: schema.workflows.name, description: schema.workflows.description, active: schema.workflows.active, triggerType: schema.workflows.triggerType })
    .from(schema.workflows)
    .where(eq(schema.workflows.orgId, org.id))
    .orderBy(desc(schema.workflows.updatedAt));
  return rows;
}

export async function apiRunWorkflow(org: Org, workflowId: string, input: unknown, via: "api" | "mcp") {
  if (!planAllows(org.plan, "PRO")) throw new HttpError(402, "API & MCP access needs the Pro plan or higher");
  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(and(eq(schema.workflows.id, workflowId), eq(schema.workflows.orgId, org.id)))
    .limit(1);
  if (!wf) throw new HttpError(404, "Workflow not found");
  const problems = validateGraph(wf.graph);
  if (problems.length) throw new HttpError(422, problems[0]);
  if (creditsRemaining(org) <= 0) throw new HttpError(402, "Out of credits");
  const t = findTrigger(wf.graph);
  // Webhook-triggered workflows expect { body: … }; wrap plain input so mappings keep working.
  const payload = t?.type === "trigger.webhook" ? { method: "POST", body: input, query: {}, headers: {} } : input;
  const { executionId, outcome } = await startRun(wf, via, payload, { wait: true });
  return { executionId, status: outcome?.status, output: outcome?.output, error: outcome?.error, creditsUsed: outcome?.creditsUsed };
}

export async function apiGetExecution(org: Org, id: string) {
  const [ex] = await db
    .select()
    .from(schema.executions)
    .where(and(eq(schema.executions.id, id), eq(schema.executions.orgId, org.id)))
    .limit(1);
  if (!ex) throw new HttpError(404, "Execution not found");
  return ex;
}
