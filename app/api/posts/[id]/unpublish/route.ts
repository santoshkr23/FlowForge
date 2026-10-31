import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";
import { connectionHelpers } from "@/lib/engine/connections";
import { linkedinDelete } from "@/lib/social/linkedin";
import { apiCall } from "@/lib/engine/net";

/** Delete a published post from the platforms that allow it (LinkedIn, X). */
export const POST = withAuth("BUILDER", async (ctx, _req, { params }) => {
  const [p] = await db.select().from(schema.posts).where(and(eq(schema.posts.id, params.id), eq(schema.posts.orgId, ctx.org.id))).limit(1);
  if (!p) return err("Not found", 404);
  const h = connectionHelpers(ctx.org.id);
  const results = [...(p.results ?? [])];
  const out: { account?: string; ok: boolean; error?: string }[] = [];
  for (const r of results) {
    if (!r.ok || !r.url) continue;
    const connId = r.target.split(":")[0];
    try {
      if (r.app === "linkedin") await linkedinDelete(h, connId, r.url);
      else if (r.app === "x") {
        const { accessToken } = await h.token(connId);
        await apiCall(`https://api.x.com/2/tweets/${r.url.split("/").pop()}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
      } else continue;
      r.ok = false;
      r.url = undefined;
      r.note = "Deleted from FlowForge";
      out.push({ account: r.account, ok: true });
    } catch (e) {
      out.push({ account: r.account, ok: false, error: (e as Error).message });
    }
  }
  if (!out.length) return err("Nothing here can be deleted from FlowForge (only LinkedIn and X posts can)", 422);
  const [saved] = await db.update(schema.posts).set({ results, status: results.some((r) => r.ok) ? "partial" : "deleted" }).where(eq(schema.posts.id, p.id)).returning();
  return json({ post: saved, out });
});
