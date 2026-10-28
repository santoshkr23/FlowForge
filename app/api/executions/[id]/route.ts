import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";

export const GET = withAuth("VIEWER", async (ctx, _req, { params }) => {
  const [ex] = await db
    .select()
    .from(schema.executions)
    .where(and(eq(schema.executions.id, params.id), eq(schema.executions.orgId, ctx.org.id)))
    .limit(1);
  return ex ? json(ex) : err("Not found", 404);
});
