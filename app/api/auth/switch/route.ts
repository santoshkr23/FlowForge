import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { body, err, json, withAuth } from "@/lib/http";

export const POST = withAuth("VIEWER", async (ctx, req) => {
  const { orgId } = await body(req, z.object({ orgId: z.string() }));
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, ctx.user.id), eq(schema.memberships.orgId, orgId)))
    .limit(1);
  if (!m) return err("Not a member of that workspace", 403);
  await createSession({ uid: ctx.user.id, oid: orgId });
  return json({ ok: true });
});
