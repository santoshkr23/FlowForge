import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { randomToken, sha256 } from "./crypto";

export async function createApiKey(orgId: string, name: string) {
  const key = `ff_${randomToken(30)}`;
  const [row] = await db.insert(schema.apiKeys).values({ orgId, name, prefix: key.slice(0, 10), hash: sha256(key) }).returning();
  return { key, row };
}

/** Accepts "Authorization: Bearer ff_…" or "x-api-key: ff_…". Returns the org or null. */
export async function orgFromApiKey(req: Request) {
  const h = req.headers.get("authorization");
  const key = (h?.startsWith("Bearer ") ? h.slice(7) : req.headers.get("x-api-key"))?.trim();
  if (!key?.startsWith("ff_")) return null;
  const [row] = await db
    .select({ k: schema.apiKeys, o: schema.orgs })
    .from(schema.apiKeys)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.apiKeys.orgId))
    .where(eq(schema.apiKeys.hash, sha256(key)))
    .limit(1);
  if (!row) return null;
  db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.k.id)).catch(() => {});
  return row.o;
}
