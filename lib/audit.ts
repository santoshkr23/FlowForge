import { db, schema } from "./db";

export async function audit(orgId: string, userId: string | null, action: string, target?: string, meta?: unknown) {
  try {
    await db.insert(schema.auditLogs).values({ orgId, userId, action, target, meta: meta ?? null });
  } catch (e) {
    console.error("audit failed", e);
  }
}
