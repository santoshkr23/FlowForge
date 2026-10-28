import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, err, json, withAuth } from "@/lib/http";
import { createWorkflow } from "@/lib/workflows";
import { TEMPLATES } from "@/lib/templates";
import { audit } from "@/lib/audit";

export const GET = withAuth("VIEWER", async (ctx) => {
  const rows = await db
    .select({
      id: schema.workflows.id,
      name: schema.workflows.name,
      active: schema.workflows.active,
      triggerType: schema.workflows.triggerType,
      updatedAt: schema.workflows.updatedAt,
    })
    .from(schema.workflows)
    .where(eq(schema.workflows.orgId, ctx.org.id))
    .orderBy(desc(schema.workflows.updatedAt));
  return json(rows);
});

export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(120).optional(), templateId: z.string().optional() }));
  const tpl = b.templateId ? TEMPLATES.find((t) => t.id === b.templateId) : undefined;
  if (b.templateId && !tpl) return err("Template not found", 404);
  const wf = await createWorkflow(ctx.org, ctx.user.id, b.name ?? tpl?.name ?? "Untitled workflow", tpl?.graph, tpl?.description);
  await audit(ctx.org.id, ctx.user.id, "workflow.created", wf.id, { name: wf.name, template: tpl?.id });
  return json({ id: wf.id }, 201);
});
