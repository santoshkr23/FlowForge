import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, json, withAuth } from "@/lib/http";
import { getWorkflow, saveWorkflow } from "@/lib/workflows";
import { validateGraph } from "@/lib/engine/graph";
import { audit } from "@/lib/audit";

const NodeZ = z.object({
  id: z.string().min(1).max(64),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({ label: z.string().max(120).optional(), config: z.record(z.unknown()).default({}) }),
});
const GraphZ = z.object({
  nodes: z.array(NodeZ).max(200),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })).max(400),
});

export const GET = withAuth("VIEWER", async (ctx, _req, { params }) => {
  const wf = await getWorkflow(ctx.org.id, params.id);
  return json({ ...wf, problems: validateGraph(wf.graph) });
});

export const PUT = withAuth("BUILDER", async (ctx, req, { params }) => {
  const b = await body(
    req,
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(1000).nullable().optional(),
      folder: z.string().max(60).nullable().optional(),
      graph: GraphZ.optional(),
    }),
  );
  const wf = await saveWorkflow(ctx.org, params.id, b as Parameters<typeof saveWorkflow>[2]);
  return json({ ...wf, problems: validateGraph(wf.graph) });
});

export const DELETE = withAuth("BUILDER", async (ctx, _req, { params }) => {
  const wf = await getWorkflow(ctx.org.id, params.id);
  await db.delete(schema.workflows).where(eq(schema.workflows.id, wf.id));
  await audit(ctx.org.id, ctx.user.id, "workflow.deleted", wf.id, { name: wf.name });
  return json({ ok: true });
});
