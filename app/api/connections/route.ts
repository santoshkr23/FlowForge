import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, err, json, withAuth } from "@/lib/http";
import { encryptJson } from "@/lib/crypto";
import { APPS } from "@/lib/engine/catalog";
import { audit } from "@/lib/audit";

export const GET = withAuth("VIEWER", async (ctx) => {
  const rows = await db
    .select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name, createdAt: schema.connections.createdAt })
    .from(schema.connections)
    .where(eq(schema.connections.orgId, ctx.org.id))
    .orderBy(desc(schema.connections.createdAt));
  return json(rows);
});

export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = await body(req, z.object({ app: z.string(), name: z.string().trim().min(1).max(80), values: z.record(z.string()) }));
  const app = APPS[b.app];
  if (!app) return err("Unknown app", 404);
  for (const f of app.fields) if (!b.values[f.key]?.trim() && !f.placeholder) return err(`${f.label} is required`, 422);
  const values = Object.fromEntries(app.fields.map((f) => [f.key, (b.values[f.key] ?? "").trim()]));
  if (b.app === "google") {
    try {
      const sa = JSON.parse(values.serviceAccountJson);
      if (!sa.client_email || !sa.private_key) throw new Error();
    } catch {
      return err("That doesn't look like a service-account JSON key", 422);
    }
  }
  const [c] = await db.insert(schema.connections).values({ orgId: ctx.org.id, app: b.app, name: b.name, secret: encryptJson(values) }).returning();
  await audit(ctx.org.id, ctx.user.id, "connection.created", c.id, { app: b.app, name: b.name });
  return json({ id: c.id, app: c.app, name: c.name }, 201);
});
