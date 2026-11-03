/** Stop FlowForge from posting the same content twice — and from looping when you watch your own profile. */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { cleanPost } from "./rewrite";

const norm = (t: string) => cleanPost(t).text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** True when a post sent (or scheduled) through FlowForge in the last 60 days already contains this text. Drafts and failures don't count. */
export async function alreadyPosted(orgId: string, text: string): Promise<boolean> {
  const key = norm(text).slice(0, 120);
  if (key.length < 30) return false; // too short to judge
  const since = new Date(Date.now() - 60 * 86400_000);
  const rows = await db
    .select({ text: schema.posts.text })
    .from(schema.posts)
    .where(and(eq(schema.posts.orgId, orgId), gte(schema.posts.createdAt, since), inArray(schema.posts.status, ["posted", "partial", "posting", "scheduled"])))
    .limit(500);
  return rows.some((r) => norm(r.text).includes(key));
}
