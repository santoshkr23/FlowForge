import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, err, json, withAuth } from "@/lib/http";
import { WatchBody, clean, validTargets } from "@/lib/social/watch-input";
import { audit } from "@/lib/audit";

export const GET = withAuth("VIEWER", async (ctx) => {
  return json(await db.select().from(schema.watches).where(eq(schema.watches.orgId, ctx.org.id)).orderBy(desc(schema.watches.createdAt)));
});

export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = clean(await body(req, WatchBody));
  if (!b.profileUrl && !b.feedUrl) return err("Add the person's LinkedIn profile link or a feed link", 422);
  if (b.profileUrl && !/linkedin\.com\/(in|company)\//i.test(b.profileUrl)) return err("That doesn't look like a LinkedIn profile link (linkedin.com/in/…)", 422);
  if (b.mode === "post" && !b.targets.length) return err("Pick at least one of your accounts to post to, or choose 'Save as draft'", 422);
  if (!(await validTargets(ctx.org.id, b.targets))) return err("One of the selected accounts isn't connected any more", 422);
  const [w] = await db.insert(schema.watches).values({ ...b, orgId: ctx.org.id, nextCheckAt: new Date() }).returning();
  await audit(ctx.org.id, ctx.user.id, "watch.created", w.id, { name: w.name });
  return json(w, 201);
});
