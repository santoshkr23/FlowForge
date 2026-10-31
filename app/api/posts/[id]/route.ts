import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";

/** Cancel a scheduled post or remove one from history (doesn't delete it from the platforms). */
export const DELETE = withAuth("BUILDER", async (ctx, _req, { params }) => {
  const rows = await db
    .delete(schema.posts)
    .where(and(eq(schema.posts.id, params.id), eq(schema.posts.orgId, ctx.org.id), ne(schema.posts.status, "posting")))
    .returning({ id: schema.posts.id });
  if (!rows.length) return err("Not found, or it is being posted right now", 404);
  return json({ ok: true });
});
