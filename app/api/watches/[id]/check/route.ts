import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";
import { checkWatch } from "@/lib/social/watch";

export const maxDuration = 300;

/** Check a watch now instead of waiting for the timer. */
export const POST = withAuth("BUILDER", async (ctx, _req, { params }) => {
  const [w] = await db.select().from(schema.watches).where(and(eq(schema.watches.id, params.id), eq(schema.watches.orgId, ctx.org.id))).limit(1);
  if (!w) return err("Not found", 404);
  const r = await checkWatch(w);
  const [fresh] = await db.select().from(schema.watches).where(eq(schema.watches.id, w.id));
  return json({ ...r, watch: fresh, firstCheck: !w.seeded });
});
