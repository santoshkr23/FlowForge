import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, err, json, withAuth } from "@/lib/http";
import { WatchBody, clean, validTargets } from "@/lib/social/watch-input";

export const PATCH = withAuth("BUILDER", async (ctx, req, { params }) => {
  const b = clean(await body(req, WatchBody));
  if (!b.profileUrl && !b.feedUrl) return err("Add the person's LinkedIn profile link or a feed link", 422);
  if (b.mode === "post" && !b.targets.length) return err("Pick at least one of your accounts to post to, or choose 'Save as draft'", 422);
  if (!(await validTargets(ctx.org.id, b.targets))) return err("One of the selected accounts isn't connected any more", 422);
  const [old] = await db.select().from(schema.watches).where(and(eq(schema.watches.id, params.id), eq(schema.watches.orgId, ctx.org.id))).limit(1);
  if (!old) return err("Not found", 404);
  const sourceChanged = old.profileUrl !== b.profileUrl || old.feedUrl !== b.feedUrl;
  const [w] = await db
    .update(schema.watches)
    .set({ ...b, ...(sourceChanged ? { seen: [], seeded: false, nextCheckAt: new Date() } : {}), ...(b.active && !old.active ? { nextCheckAt: new Date() } : {}) })
    .where(eq(schema.watches.id, old.id))
    .returning();
  return json(w);
});

export const DELETE = withAuth("BUILDER", async (ctx, _req, { params }) => {
  const r = await db.delete(schema.watches).where(and(eq(schema.watches.id, params.id), eq(schema.watches.orgId, ctx.org.id))).returning({ id: schema.watches.id });
  if (!r.length) return err("Not found", 404);
  return json({ ok: true });
});
