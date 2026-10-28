import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { audit } from "@/lib/audit";

export const DELETE = withAuth("ADMIN", async (ctx, _req, { params }) => {
  await db.delete(schema.apiKeys).where(and(eq(schema.apiKeys.id, params.id), eq(schema.apiKeys.orgId, ctx.org.id)));
  await audit(ctx.org.id, ctx.user.id, "apikey.revoked", params.id);
  return json({ ok: true });
});
