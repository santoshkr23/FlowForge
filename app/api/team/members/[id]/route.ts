import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, err, json, withAuth } from "@/lib/http";
import { audit } from "@/lib/audit";

async function membership(orgId: string, id: string) {
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.id, id), eq(schema.memberships.orgId, orgId)))
    .limit(1);
  return m;
}

export const PATCH = withAuth("ADMIN", async (ctx, req, { params }) => {
  const { role } = await body(req, z.object({ role: z.enum(["ADMIN", "BUILDER", "VIEWER"]) }));
  const m = await membership(ctx.org.id, params.id);
  if (!m) return err("Not found", 404);
  if (m.role === "OWNER") return err("The owner's role can't be changed", 403);
  await db.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, m.id));
  await audit(ctx.org.id, ctx.user.id, "member.role_changed", m.userId, { role });
  return json({ ok: true });
});

export const DELETE = withAuth("ADMIN", async (ctx, _req, { params }) => {
  const m = await membership(ctx.org.id, params.id);
  if (!m) return err("Not found", 404);
  if (m.role === "OWNER") return err("The owner can't be removed", 403);
  await db.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
  await audit(ctx.org.id, ctx.user.id, "member.removed", m.userId);
  return json({ ok: true });
});
