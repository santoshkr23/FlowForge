import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireCtx, hasRole } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Builder } from "@/components/builder/Builder";

export const metadata = { title: "Edit workflow" };

export default async function EditWorkflow(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx();
  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(and(eq(schema.workflows.id, params.id), eq(schema.workflows.orgId, ctx.org.id)))
    .limit(1);
  if (!wf) notFound();
  const [connections, [lastRun]] = await Promise.all([
    db
      .select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name })
      .from(schema.connections)
      .where(eq(schema.connections.orgId, ctx.org.id)),
    db
      .select({ steps: schema.executions.steps, status: schema.executions.status, id: schema.executions.id })
      .from(schema.executions)
      .where(eq(schema.executions.workflowId, wf.id))
      .orderBy(desc(schema.executions.startedAt))
      .limit(1),
  ]);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  return (
    <Builder
      workflow={{ id: wf.id, name: wf.name, graph: wf.graph, active: wf.active, triggerType: wf.triggerType }}
      webhookUrl={wf.webhookToken ? `${appUrl}/api/hooks/${wf.webhookToken}` : null}
      connections={connections}
      plan={ctx.org.plan}
      readOnly={!hasRole(ctx.role, "BUILDER")}
      lastRun={lastRun ? { id: lastRun.id, status: lastRun.status, steps: lastRun.steps ?? [] } : null}
    />
  );
}
