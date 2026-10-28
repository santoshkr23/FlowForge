import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";
import { audit } from "@/lib/audit";

export const DELETE = withAuth("BUILDER", async (ctx, _req, { params }) => {
  const rows = await db
    .delete(schema.connections)
    .where(and(eq(schema.connections.id, params.id), eq(schema.connections.orgId, ctx.org.id)))
    .returning();
  if (!rows.length) return err("Not found", 404);
  await audit(ctx.org.id, ctx.user.id, "connection.deleted", params.id, { name: rows[0].name });
  return json({ ok: true });
});
